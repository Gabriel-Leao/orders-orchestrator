import { randomUUID } from 'node:crypto';
import { Order } from '../../src/orders/entities/order.entity';
import { OrderStatus } from '../../src/orders/enums/order-status.enum';
import type { OrderResponseDto } from '../../src/orders/dto/order-response.dto';
import type { PaginatedOrdersResponseDto } from '../../src/orders/dto/paginated-orders-response.dto';
import { type ErrorBody, authedGet } from '../support/http';
import { type TestContext, createTestApp } from '../support/test-app';
import request from 'supertest';

// Estes testes só leem: os pedidos são gravados direto no banco, sem fila.
// Sem job enfileirado, o worker nunca os toca e o status semeado é preservado.
describe('GET /orders e GET /orders/:id', () => {
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

  let seq = 0;
  const seed = async (
    overrides: Partial<Order> = {},
    createdAt: Date = new Date(),
  ): Promise<Order> => {
    seq += 1;
    const id = overrides.id ?? randomUUID();
    await ctx.orders.insert({
      id,
      externalOrderId: `seed-${seq}-${id}`,
      idempotencyKey: `seed-key-${seq}-${id}`,
      customerEmail: 'user@example.com',
      customerName: 'Ana',
      items: [{ sku: 'ABC123', qty: 2, unitPrice: 59.9 }],
      currency: 'USD',
      total: 119.8,
      status: OrderStatus.RECEIVED,
      createdAt,
      ...overrides,
    });
    return ctx.orders.findOneByOrFail({ id });
  };

  const list = async (query = ''): Promise<PaginatedOrdersResponseDto> => {
    const res = await authedGet(ctx.server, `/orders${query}`).expect(200);
    return res.body as PaginatedOrdersResponseDto;
  };

  describe('GET /orders', () => {
    it('exige API key', async () => {
      await request(ctx.server).get('/orders').expect(401);
    });

    it('sem pedidos: 200 com lista vazia e meta zerada', async () => {
      expect(await list()).toEqual({
        data: [],
        meta: { page: 1, limit: 20, total: 0, total_pages: 0 },
      });
    });

    it('aplica paginação padrão (página 1, limite 20) e devolve o formato público', async () => {
      const order = await seed();

      const body = await list();

      expect(body.meta).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        total_pages: 1,
      });
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({
        id: order.id,
        order_id: order.externalOrderId,
        status: OrderStatus.RECEIVED,
        total: 119.8,
        enrichment: null,
      });
      expect(Object.keys(body.data[0])).not.toContain('externalOrderId');
      expect(Object.keys(body.data[0])).not.toContain('idempotencyKey');
    });

    it('ordena do mais recente para o mais antigo', async () => {
      const oldest = await seed({}, new Date('2026-10-01T10:00:00Z'));
      const newest = await seed({}, new Date('2026-10-03T10:00:00Z'));
      const middle = await seed({}, new Date('2026-10-02T10:00:00Z'));

      const body = await list();

      expect(body.data.map((o) => o.id)).toEqual([
        newest.id,
        middle.id,
        oldest.id,
      ]);
    });

    it('desempata created_at idêntico por id decrescente, de forma estável', async () => {
      const sameInstant = new Date('2026-10-01T10:00:00Z');
      const seeded = await Promise.all(
        Array.from({ length: 6 }, () => seed({}, sameInstant)),
      );
      const expected = seeded
        .map((o) => o.id)
        .sort()
        .reverse();

      const body = await list();

      expect(body.data.map((o) => o.id)).toEqual(expected);
    });

    it('pagina sem repetir nem perder pedidos, inclusive com created_at empatado', async () => {
      const sameInstant = new Date('2026-10-01T10:00:00Z');
      const seeded: Order[] = [];
      for (let i = 0; i < 7; i += 1) seeded.push(await seed({}, sameInstant));
      for (let i = 0; i < 3; i += 1) {
        seeded.push(await seed({}, new Date(`2026-10-0${i + 2}T10:00:00Z`)));
      }

      const collected: string[] = [];
      for (const page of [1, 2, 3, 4]) {
        const body = await list(`?limit=3&page=${page}`);
        expect(body.meta).toEqual({
          page,
          limit: 3,
          total: 10,
          total_pages: 4,
        });
        collected.push(...body.data.map((o) => o.id));
      }

      expect(collected).toHaveLength(10);
      expect(new Set(collected).size).toBe(10);
      expect([...collected].sort()).toEqual(seeded.map((o) => o.id).sort());
      expect(collected).toEqual(
        (await list('?limit=100')).data.map((o) => o.id),
      );
    });

    it('página além do fim: 200 com data vazio e meta coerente', async () => {
      await seed();

      expect(await list('?page=5&limit=10')).toEqual({
        data: [],
        meta: { page: 5, limit: 10, total: 1, total_pages: 1 },
      });
    });

    it('filtra por status; total e total_pages refletem o filtro', async () => {
      await seed({ status: OrderStatus.RECEIVED });
      await seed({ status: OrderStatus.ENRICHED });
      await seed({ status: OrderStatus.ENRICHED });
      await seed({
        status: OrderStatus.FAILED_ENRICHMENT,
        failureReason: 'boom',
      });

      const enriched = await list('?status=ENRICHED&limit=1');
      expect(enriched.meta).toEqual({
        page: 1,
        limit: 1,
        total: 2,
        total_pages: 2,
      });
      expect(
        enriched.data.every((o) => o.status === OrderStatus.ENRICHED),
      ).toBe(true);

      const failed = await list('?status=FAILED_ENRICHMENT');
      expect(failed.data).toHaveLength(1);
      expect(failed.data[0].failure_reason).toBe('boom');

      expect((await list('?status=PROCESSING')).meta.total).toBe(0);
      expect((await list()).meta.total).toBe(4);
    });

    it.each([
      ['page=0', '?page=0'],
      ['page negativa', '?page=-1'],
      ['page não numérica', '?page=abc'],
      ['page fracionária', '?page=1.5'],
      ['limit=0', '?limit=0'],
      ['limit acima do máximo (101)', '?limit=101'],
      ['limit não numérico', '?limit=muitos'],
      ['status inexistente', '?status=DONE'],
      ['status em minúsculas', '?status=enriched'],
      ['parâmetro desconhecido', '?foo=bar'],
    ])('400 para %s', async (_label, query) => {
      const res = await authedGet(ctx.server, `/orders${query}`);

      expect(res.status).toBe(400);
      expect((res.body as ErrorBody).message).toEqual(expect.any(Array));
    });

    it('aceita o limite máximo (100)', async () => {
      expect((await list('?limit=100')).meta.limit).toBe(100);
    });
  });

  describe('GET /orders/:id', () => {
    it('exige API key', async () => {
      await request(ctx.server).get(`/orders/${randomUUID()}`).expect(401);
    });

    it('200 com os detalhes, incluindo enriquecimento, tentativas e datas', async () => {
      const order = await seed({
        status: OrderStatus.ENRICHED,
        targetCurrency: 'BRL',
        convertedTotal: 628.95,
        exchangeRate: 5.25,
        exchangeRateDate: '2026-10-20',
        enrichedAt: new Date('2026-10-20T12:00:00Z'),
        attempts: 2,
      });

      const res = await authedGet(ctx.server, `/orders/${order.id}`).expect(
        200,
      );
      const body = res.body as OrderResponseDto;

      expect(body).toMatchObject({
        id: order.id,
        order_id: order.externalOrderId,
        status: OrderStatus.ENRICHED,
        customer: { email: 'user@example.com', name: 'Ana' },
        items: [{ sku: 'ABC123', qty: 2, unit_price: 59.9 }],
        currency: 'USD',
        total: 119.8,
        enrichment: {
          target_currency: 'BRL',
          converted_total: 628.95,
          exchange_rate: 5.25,
          exchange_rate_date: '2026-10-20',
          enriched_at: '2026-10-20T12:00:00.000Z',
        },
        failure_reason: null,
        attempts: 2,
      });
      expect(body.created_at).toEqual(expect.any(String));
      expect(body.updated_at).toEqual(expect.any(String));
    });

    it('expõe failure_reason de um pedido FAILED_ENRICHMENT', async () => {
      const order = await seed({
        status: OrderStatus.FAILED_ENRICHMENT,
        failureReason: 'Exchange API responded with 500',
        attempts: 3,
      });

      const res = await authedGet(ctx.server, `/orders/${order.id}`).expect(
        200,
      );

      expect(res.body).toMatchObject({
        status: OrderStatus.FAILED_ENRICHMENT,
        failure_reason: 'Exchange API responded with 500',
        attempts: 3,
        enrichment: null,
      });
    });

    it('400 quando o id não é um UUID', async () => {
      await authedGet(ctx.server, '/orders/123').expect(400);
    });

    it('404 quando o pedido não existe', async () => {
      const res = await authedGet(ctx.server, `/orders/${randomUUID()}`);

      expect(res.status).toBe(404);
    });
  });
});
