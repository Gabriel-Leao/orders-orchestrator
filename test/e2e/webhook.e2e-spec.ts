import { OrderStatus } from '../../src/orders/enums/order-status.enum';
import type { OrderResponseDto } from '../../src/orders/dto/order-response.dto';
import { OrdersProducer } from '../../src/orders/orders.producer';
import { buildWebhookPayload } from '../support/builders';
import { type ErrorBody, getOrder, postWebhook } from '../support/http';
import { type TestContext, createTestApp } from '../support/test-app';
import { waitFor } from '../support/wait-for';

describe('POST /webhooks/orders', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await ctx.reset();
  });

  afterAll(async () => {
    await ctx.close();
  });

  const settled = (id: string) =>
    waitFor(
      async () => {
        const order = await getOrder(ctx.server, id);
        return order.status === OrderStatus.ENRICHED ? order : null;
      },
      { description: `pedido ${id} ser enriquecido` },
    );

  describe('autenticação', () => {
    it.each([
      ['sem header x-api-key', null],
      ['com chave errada', 'chave-errada'],
      ['com chave vazia', ''],
    ])('401 %s, e nada é gravado', async (_label, key) => {
      const res = await postWebhook(ctx.server, buildWebhookPayload(), key);

      expect(res.status).toBe(401);
      expect(await ctx.orders.count()).toBe(0);
    });
  });

  describe('validação do payload', () => {
    const base = buildWebhookPayload();

    it.each([
      ['order_id ausente', { ...base, order_id: undefined }],
      ['order_id vazio', { ...base, order_id: '' }],
      [
        'order_id maior que 100 caracteres',
        { ...base, order_id: 'x'.repeat(101) },
      ],
      [
        'e-mail inválido',
        { ...base, customer: { email: 'nao-e-email', name: 'Ana' } },
      ],
      ['cliente ausente', { ...base, customer: undefined }],
      ['lista de itens vazia', { ...base, items: [] }],
      ['qty zero', { ...base, items: [{ sku: 'A', qty: 0, unit_price: 10 }] }],
      [
        'qty fracionária',
        { ...base, items: [{ sku: 'A', qty: 1.5, unit_price: 10 }] },
      ],
      [
        'unit_price zero',
        { ...base, items: [{ sku: 'A', qty: 1, unit_price: 0 }] },
      ],
      [
        'unit_price negativo',
        { ...base, items: [{ sku: 'A', qty: 1, unit_price: -5 }] },
      ],
      [
        'unit_price com 3 casas',
        { ...base, items: [{ sku: 'A', qty: 1, unit_price: 1.234 }] },
      ],
      [
        'unit_price como string',
        { ...base, items: [{ sku: 'A', qty: 1, unit_price: '10' }] },
      ],
      ['moeda em minúsculas', { ...base, currency: 'usd' }],
      ['moeda com 2 letras', { ...base, currency: 'US' }],
      ['idempotency_key curta', { ...base, idempotency_key: 'curta' }],
      ['campo desconhecido no payload', { ...base, extra: 'não permitido' }],
      [
        'campo desconhecido em item',
        { ...base, items: [{ sku: 'A', qty: 1, unit_price: 1, desconto: 5 }] },
      ],
    ])(
      '400 para %s, e nada é gravado nem enfileirado',
      async (_label, payload) => {
        const res = await postWebhook(ctx.server, payload);

        expect(res.status).toBe(400);
        expect((res.body as ErrorBody).message).toEqual(expect.any(Array));
        expect(await ctx.orders.count()).toBe(0);
        expect(
          await ctx.ordersQueue.getJobCounts(
            'waiting',
            'active',
            'delayed',
            'completed',
          ),
        ).toEqual({
          waiting: 0,
          active: 0,
          delayed: 0,
          completed: 0,
        });
      },
    );

    it('400 para corpo que não é JSON de objeto', async () => {
      const res = await postWebhook(ctx.server, 'texto solto');

      expect(res.status).toBe(400);
    });
  });

  describe('pedido novo', () => {
    it('202 com o pedido RECEIVED em snake_case e uma linha no banco', async () => {
      const payload = buildWebhookPayload();

      const res = await postWebhook(ctx.server, payload).expect(202);
      const body = res.body as OrderResponseDto;

      expect(body).toMatchObject({
        order_id: payload.order_id,
        status: OrderStatus.RECEIVED,
        customer: { email: 'user@example.com', name: 'Ana' },
        items: [{ sku: 'ABC123', qty: 2, unit_price: 59.9 }],
        currency: 'USD',
        total: 119.8,
        enrichment: null,
        failure_reason: null,
        attempts: 0,
      });
      expect(body.id).toMatch(/^[0-9a-f-]{36}$/);

      const rows = await ctx.orders.find();
      expect(rows).toHaveLength(1);
      expect(rows[0].idempotencyKey).toBe(payload.idempotency_key);
      await settled(body.id);
    });

    it('calcula o total em centavos inteiros (sem erro de ponto flutuante)', async () => {
      // 0.1 * 3 em float dá 0.30000000000000004; 19.99 * 3 dá 59.97 com ruído.
      const payload = buildWebhookPayload({
        items: [
          { sku: 'A', qty: 3, unit_price: 0.1 },
          { sku: 'B', qty: 3, unit_price: 19.99 },
        ],
      });

      const res = await postWebhook(ctx.server, payload).expect(202);

      expect((res.body as OrderResponseDto).total).toBe(60.27);
      await settled((res.body as OrderResponseDto).id);
    });
  });

  describe('idempotência', () => {
    it('replay da mesma idempotency_key: 200, mesmo pedido, uma única linha', async () => {
      const payload = buildWebhookPayload();
      const first = await postWebhook(ctx.server, payload).expect(202);
      const replay = await postWebhook(ctx.server, payload).expect(200);

      expect((replay.body as OrderResponseDto).id).toBe(
        (first.body as OrderResponseDto).id,
      );
      expect(await ctx.orders.count()).toBe(1);
      await settled((first.body as OrderResponseDto).id);
    });

    it('replay não altera o pedido original, mesmo com corpo diferente', async () => {
      const payload = buildWebhookPayload();
      const first = await postWebhook(ctx.server, payload).expect(202);

      const replay = await postWebhook(ctx.server, {
        ...payload,
        items: [{ sku: 'OUTRO', qty: 9, unit_price: 999 }],
      }).expect(200);

      expect((replay.body as OrderResponseDto).items).toEqual([
        { sku: 'ABC123', qty: 2, unit_price: 59.9 },
      ]);
      expect((replay.body as OrderResponseDto).total).toBe(119.8);
      await settled((first.body as OrderResponseDto).id);
    });

    it('409 quando o order_id já existe com outra idempotency_key', async () => {
      const payload = buildWebhookPayload();
      const first = await postWebhook(ctx.server, payload).expect(202);

      const conflict = await postWebhook(ctx.server, {
        ...payload,
        idempotency_key: 'outra-chave-123',
      });

      expect(conflict.status).toBe(409);
      expect((conflict.body as ErrorBody).message).toContain(payload.order_id);
      expect(await ctx.orders.count()).toBe(1);
      await settled((first.body as OrderResponseDto).id);
    });

    it('12 requisições simultâneas com a mesma chave: um 202, onze 200, uma linha e um único processamento', async () => {
      const payload = buildWebhookPayload();

      const responses = await Promise.all(
        Array.from({ length: 12 }, () => postWebhook(ctx.server, payload)),
      );

      const statuses = responses.map((r) => r.status).sort();
      expect(statuses).toEqual([...Array<number>(11).fill(200), 202]);
      const ids = new Set(
        responses.map((r) => (r.body as OrderResponseDto).id),
      );
      expect(ids.size).toBe(1);
      expect(await ctx.orders.count()).toBe(1);

      await settled([...ids][0]);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(ctx.exchange.calls).toHaveLength(1);
    });

    it('mesma idempotency_key com order_ids diferentes em paralelo: só a constraint de idempotência segura, uma linha', async () => {
      // Aqui as constraints de order_id não colidem: quem garante "um pedido por
      // chave" sob concorrência é exclusivamente UQ_orders_idempotency_key.
      const key = buildWebhookPayload().idempotency_key;

      const responses = await Promise.all(
        Array.from({ length: 8 }, () =>
          postWebhook(
            ctx.server,
            buildWebhookPayload({ idempotency_key: key }),
          ),
        ),
      );

      expect(responses.map((r) => r.status).sort()).toEqual([
        ...Array<number>(7).fill(200),
        202,
      ]);
      const ids = new Set(
        responses.map((r) => (r.body as OrderResponseDto).id),
      );
      expect(ids.size).toBe(1);
      expect(await ctx.orders.count()).toBe(1);
      await settled([...ids][0]);
    });

    it('chaves diferentes e order_ids diferentes geram pedidos independentes', async () => {
      const a = await postWebhook(ctx.server, buildWebhookPayload()).expect(
        202,
      );
      const b = await postWebhook(ctx.server, buildWebhookPayload()).expect(
        202,
      );

      expect((a.body as OrderResponseDto).id).not.toBe(
        (b.body as OrderResponseDto).id,
      );
      expect(await ctx.orders.count()).toBe(2);
      await settled((a.body as OrderResponseDto).id);
      await settled((b.body as OrderResponseDto).id);
    });
  });

  describe('falha ao enfileirar', () => {
    it('503 mantém o pedido RECEIVED; reenviar a mesma chave reenfileira e conclui o fluxo', async () => {
      const payload = buildWebhookPayload();
      jest
        .spyOn(ctx.app.get(OrdersProducer), 'enqueueEnrichment')
        .mockRejectedValueOnce(
          new Error('Redis did not respond within 3000ms'),
        );

      const failed = await postWebhook(ctx.server, payload);

      expect(failed.status).toBe(503);
      const orphan = await ctx.orders.findOneByOrFail({
        idempotencyKey: payload.idempotency_key,
      });
      expect(orphan.status).toBe(OrderStatus.RECEIVED);
      expect(
        await ctx.ordersQueue.getJobCounts('waiting', 'active', 'delayed'),
      ).toEqual({
        waiting: 0,
        active: 0,
        delayed: 0,
      });

      const retry = await postWebhook(ctx.server, payload).expect(200);

      expect((retry.body as OrderResponseDto).id).toBe(orphan.id);
      await settled(orphan.id);
      expect(await ctx.orders.count()).toBe(1);
    });
  });
});
