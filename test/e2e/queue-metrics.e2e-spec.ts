import request from 'supertest';
import { PermanentEnrichmentError } from '../../src/enrichment/enrichment.errors';
import type { QueueMetricsResponseDto } from '../../src/queue/dto/queue-metrics-response.dto';
import {
  ORDERS_DLQ,
  ORDERS_QUEUE,
  QUEUE_PREFIX,
} from '../../src/queue/queue.constants';
import { buildWebhookPayload } from '../support/builders';
import { type ErrorBody, authedGet, postWebhook } from '../support/http';
import { type TestContext, createTestApp } from '../support/test-app';
import { waitFor } from '../support/wait-for';

describe('GET /queue/metrics', () => {
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

  const metrics = async (): Promise<QueueMetricsResponseDto> => {
    const res = await authedGet(ctx.server, '/queue/metrics').expect(200);
    return res.body as QueueMetricsResponseDto;
  };

  it('exige API key', async () => {
    await request(ctx.server).get('/queue/metrics').expect(401);
  });

  it('fila vazia: prefixo, nomes e contadores zerados', async () => {
    expect(await metrics()).toEqual({
      prefix: QUEUE_PREFIX,
      queue: {
        name: ORDERS_QUEUE,
        is_paused: false,
        counts: { waiting: 0, active: 0, delayed: 0, completed: 0, failed: 0 },
      },
      dead_letter_queue: {
        name: ORDERS_DLQ,
        is_paused: false,
        counts: { waiting: 0, active: 0, delayed: 0, completed: 0, failed: 0 },
      },
    });
  });

  it('após pedidos processados com sucesso, conta jobs completed e DLQ vazia', async () => {
    await postWebhook(ctx.server, buildWebhookPayload()).expect(202);
    await postWebhook(ctx.server, buildWebhookPayload()).expect(202);

    const body = await waitFor(
      async () => {
        const current = await metrics();
        return current.queue.counts.completed === 2 ? current : null;
      },
      { description: '2 jobs completed' },
    );

    expect(body.queue.counts).toMatchObject({
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
    });
    expect(body.dead_letter_queue.counts.waiting).toBe(0);
  });

  it('após falha definitiva, conta job failed na fila e job waiting na DLQ', async () => {
    ctx.exchange.failAlways(new PermanentEnrichmentError('rejeitado'));
    await postWebhook(ctx.server, buildWebhookPayload()).expect(202);

    const body = await waitFor(
      async () => {
        const current = await metrics();
        return current.dead_letter_queue.counts.waiting === 1 ? current : null;
      },
      { description: '1 job na DLQ' },
    );

    expect(body.queue.counts).toMatchObject({
      failed: 1,
      completed: 0,
      active: 0,
    });
  });

  it('reflete job em andamento (active) enquanto o serviço externo não responde', async () => {
    const release = ctx.exchange.hold();
    await postWebhook(ctx.server, buildWebhookPayload()).expect(202);

    const body = await waitFor(
      async () => {
        const current = await metrics();
        return current.queue.counts.active === 1 ? current : null;
      },
      { description: '1 job active' },
    );
    expect(body.queue.counts.waiting).toBe(0);

    release();
    await waitFor(async () => (await metrics()).queue.counts.completed === 1, {
      description: 'job concluído',
    });
  });

  it('503 quando o Redis não responde', async () => {
    jest
      .spyOn(ctx.ordersQueue, 'getJobCounts')
      .mockRejectedValueOnce(new Error('Connection is closed'));

    const res = await authedGet(ctx.server, '/queue/metrics');

    expect(res.status).toBe(503);
    expect((res.body as ErrorBody).message).toBe('Queue backend unavailable');
  });
});
