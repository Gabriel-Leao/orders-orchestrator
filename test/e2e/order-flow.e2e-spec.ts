import { OrderStatus } from '../../src/orders/enums/order-status.enum';
import {
  PermanentEnrichmentError,
  RetryableEnrichmentError,
} from '../../src/enrichment/enrichment.errors';
import type { DeadLetterJobData } from '../../src/queue/queue.constants';
import type { OrderResponseDto } from '../../src/orders/dto/order-response.dto';
import { buildWebhookPayload } from '../support/builders';
import { getOrder, postWebhook } from '../support/http';
import { TEST_MAX_ATTEMPTS, TEST_TARGET_CURRENCY } from '../support/test-env';
import { type TestContext, createTestApp } from '../support/test-app';
import { waitFor } from '../support/wait-for';

describe('Fluxo assíncrono do pedido (webhook → fila → enriquecimento)', () => {
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

  const waitForStatus = (id: string, status: OrderStatus) =>
    waitFor(
      async () => {
        const order = await getOrder(ctx.server, id);
        return order.status === status ? order : null;
      },
      { description: `pedido ${id} chegar em ${status}` },
    );

  /** Status de destino das transições tentadas pelo worker, em ordem. */
  const recordTransitions = () => {
    const spy = jest.spyOn(ctx.ordersService, 'transition');
    return () => spy.mock.calls.map(([, to]) => to);
  };

  describe('cenário 1: sucesso', () => {
    it('responde 202 como RECEIVED e o worker leva o pedido a ENRICHED com os valores convertidos', async () => {
      ctx.exchange.setRate(5.25, '2026-10-20');
      const transitions = recordTransitions();
      const payload = buildWebhookPayload(); // 2 x 59.90 USD = 119.80

      const res = await postWebhook(ctx.server, payload).expect(202);
      const accepted = res.body as OrderResponseDto;
      expect(accepted.status).toBe(OrderStatus.RECEIVED);
      expect(accepted.attempts).toBe(0);
      expect(accepted.enrichment).toBeNull();

      const order = await waitForStatus(accepted.id, OrderStatus.ENRICHED);

      expect(order.total).toBe(119.8);
      expect(order.attempts).toBe(1);
      expect(order.failure_reason).toBeNull();
      expect(order.enrichment).toMatchObject({
        target_currency: TEST_TARGET_CURRENCY,
        converted_total: 628.95, // 119.80 * 5.25
        exchange_rate: 5.25,
        exchange_rate_date: '2026-10-20',
      });
      expect(order.enrichment?.enriched_at).toEqual(expect.any(String));
      expect(ctx.exchange.calls).toEqual([
        { from: 'USD', to: TEST_TARGET_CURRENCY },
      ]);
      expect(transitions()).toEqual([
        OrderStatus.PROCESSING,
        OrderStatus.ENRICHED,
      ]);
    });

    it('expõe o estado intermediário PROCESSING enquanto o serviço externo não responde', async () => {
      const release = ctx.exchange.hold();

      const res = await postWebhook(ctx.server, buildWebhookPayload()).expect(
        202,
      );
      const { id } = res.body as OrderResponseDto;

      const processing = await waitForStatus(id, OrderStatus.PROCESSING);
      expect(processing.enrichment).toBeNull();
      expect(processing.attempts).toBe(1);

      release();
      await waitForStatus(id, OrderStatus.ENRICHED);
    });

    it('replay da mesma idempotency_key devolve 200 com o mesmo pedido, sem duplicar nem reprocessar', async () => {
      const payload = buildWebhookPayload();
      const first = await postWebhook(ctx.server, payload).expect(202);
      const { id } = first.body as OrderResponseDto;
      await waitForStatus(id, OrderStatus.ENRICHED);

      const replay = await postWebhook(ctx.server, payload).expect(200);
      expect((replay.body as OrderResponseDto).id).toBe(id);
      expect((replay.body as OrderResponseDto).status).toBe(
        OrderStatus.ENRICHED,
      );

      // Dá tempo a um eventual reprocessamento indevido aparecer.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await ctx.orders.count()).toBe(1);
      expect(ctx.exchange.calls).toHaveLength(1);
      expect((await getOrder(ctx.server, id)).attempts).toBe(1);
      expect(await ctx.ordersQueue.getJobCounts('completed')).toEqual({
        completed: 1,
      });
    });

    it('não chama o serviço externo quando a moeda do pedido já é a moeda alvo', async () => {
      const payload = buildWebhookPayload({ currency: TEST_TARGET_CURRENCY });

      const res = await postWebhook(ctx.server, payload).expect(202);
      const order = await waitForStatus(
        (res.body as OrderResponseDto).id,
        OrderStatus.ENRICHED,
      );

      expect(ctx.exchange.calls).toHaveLength(0);
      expect(order.enrichment).toMatchObject({
        target_currency: TEST_TARGET_CURRENCY,
        exchange_rate: 1,
        converted_total: order.total,
      });
    });
  });

  describe('retry com backoff', () => {
    it('falha transitória: retenta e conclui na última tentativa permitida', async () => {
      ctx.exchange.failTimes(TEST_MAX_ATTEMPTS - 1);
      const transitions = recordTransitions();

      const res = await postWebhook(ctx.server, buildWebhookPayload()).expect(
        202,
      );
      const order = await waitForStatus(
        (res.body as OrderResponseDto).id,
        OrderStatus.ENRICHED,
      );

      expect(order.attempts).toBe(TEST_MAX_ATTEMPTS);
      expect(order.failure_reason).toBeNull();
      expect(ctx.exchange.calls).toHaveLength(TEST_MAX_ATTEMPTS);
      expect(transitions()).toEqual([
        ...Array<OrderStatus>(TEST_MAX_ATTEMPTS).fill(OrderStatus.PROCESSING),
        OrderStatus.ENRICHED,
      ]);
      expect((await ctx.dlq.getJobCounts('waiting')).waiting).toBe(0);
    });

    it('espaça as tentativas com backoff exponencial (não retenta em rajada)', async () => {
      ctx.exchange.failTimes(TEST_MAX_ATTEMPTS - 1);
      const startedAt = Date.now();

      const res = await postWebhook(ctx.server, buildWebhookPayload()).expect(
        202,
      );
      await waitForStatus(
        (res.body as OrderResponseDto).id,
        OrderStatus.ENRICHED,
      );

      // backoff 100ms exponencial: 100 + 200 = 300ms de espera mínima.
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(300);
    });
  });

  describe('cenário 2: DLQ', () => {
    it('serviço sempre falhando: esgota as tentativas, vai para a DLQ e o pedido vira FAILED_ENRICHMENT', async () => {
      ctx.exchange.failAlways(new RetryableEnrichmentError('API fora do ar'));
      const transitions = recordTransitions();

      const res = await postWebhook(ctx.server, buildWebhookPayload()).expect(
        202,
      );
      const { id } = res.body as OrderResponseDto;
      const order = await waitForStatus(id, OrderStatus.FAILED_ENRICHMENT);

      expect(order.attempts).toBe(TEST_MAX_ATTEMPTS);
      expect(order.failure_reason).toBe('API fora do ar');
      expect(order.enrichment).toBeNull();
      expect(ctx.exchange.calls).toHaveLength(TEST_MAX_ATTEMPTS);
      expect(transitions()).toEqual([
        ...Array<OrderStatus>(TEST_MAX_ATTEMPTS).fill(OrderStatus.PROCESSING),
        OrderStatus.FAILED_ENRICHMENT,
      ]);

      const dlqJobs = await waitFor(
        async () => {
          const jobs = await ctx.dlq.getJobs(['waiting']);
          return jobs.length > 0 ? jobs : null;
        },
        { description: 'job na orders-dlq' },
      );
      expect(dlqJobs).toHaveLength(1);
      expect(dlqJobs[0].id).toBe(id);
      expect(dlqJobs[0].data as DeadLetterJobData).toMatchObject({
        orderId: id,
        reason: 'API fora do ar',
        attempts: TEST_MAX_ATTEMPTS,
      });
      expect((await ctx.ordersQueue.getJobCounts('failed')).failed).toBe(1);
    });

    it('erro permanente: vai direto para a DLQ na 1ª tentativa, sem gastar as demais', async () => {
      ctx.exchange.failAlways(
        new PermanentEnrichmentError('Moeda não suportada'),
      );

      const res = await postWebhook(ctx.server, buildWebhookPayload()).expect(
        202,
      );
      const { id } = res.body as OrderResponseDto;
      const order = await waitForStatus(id, OrderStatus.FAILED_ENRICHMENT);

      expect(order.attempts).toBe(1);
      expect(order.failure_reason).toBe('Moeda não suportada');
      expect(ctx.exchange.calls).toHaveLength(1);
      await waitFor(
        async () => (await ctx.dlq.getJobCounts('waiting')).waiting === 1,
        {
          description: 'job na orders-dlq',
        },
      );
    });

    it('replay de pedido FAILED_ENRICHMENT devolve 200 sem reprocessar nem criar novo job na DLQ', async () => {
      ctx.exchange.failAlways(
        new PermanentEnrichmentError('Moeda não suportada'),
      );
      const payload = buildWebhookPayload();
      const first = await postWebhook(ctx.server, payload).expect(202);
      const { id } = first.body as OrderResponseDto;
      await waitForStatus(id, OrderStatus.FAILED_ENRICHMENT);
      await waitFor(
        async () => (await ctx.dlq.getJobCounts('waiting')).waiting === 1,
        {
          description: 'job na orders-dlq',
        },
      );

      const replay = await postWebhook(ctx.server, payload).expect(200);
      expect((replay.body as OrderResponseDto).status).toBe(
        OrderStatus.FAILED_ENRICHMENT,
      );

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(ctx.exchange.calls).toHaveLength(1);
      expect((await ctx.dlq.getJobCounts('waiting')).waiting).toBe(1);
      expect((await getOrder(ctx.server, id)).attempts).toBe(1);
    });
  });
});
