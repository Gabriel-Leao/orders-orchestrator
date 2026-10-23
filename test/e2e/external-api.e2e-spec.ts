import {
  type IncomingMessage,
  type Server,
  type ServerResponse,
  createServer,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { OrderStatus } from '../../src/orders/enums/order-status.enum';
import type { OrderResponseDto } from '../../src/orders/dto/order-response.dto';
import { buildWebhookPayload } from '../support/builders';
import { getOrder, postWebhook } from '../support/http';
import { TEST_MAX_ATTEMPTS } from '../support/test-env';
import { type TestContext, createTestApp } from '../support/test-app';
import { waitFor } from '../support/wait-for';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * Usa o FrankfurterExchangeRateClient de verdade contra um servidor HTTP local
 * que imita a API. Valida a URL montada, a classificação de erros (retry x DLQ)
 * e o timeout, ponta a ponta, sem depender da internet.
 */
describe('Integração com a API externa de câmbio (client real, servidor fake)', () => {
  let ctx: TestContext;
  let stub: Server;
  let handler: Handler;
  const requests: string[] = [];

  beforeAll(async () => {
    stub = createServer((req, res) => {
      requests.push(req.url ?? '');
      handler(req, res);
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const { port } = stub.address() as AddressInfo;

    ctx = await createTestApp({
      realExchangeClient: true,
      env: {
        EXCHANGE_API_URL: `http://127.0.0.1:${port}/v1/`,
        EXTERNAL_TIMEOUT_MS: '300',
      },
    });
  });

  beforeEach(async () => {
    requests.length = 0;
    await ctx.reset();
  });

  afterAll(async () => {
    try {
      await ctx?.close();
    } finally {
      stub.closeAllConnections();
      await new Promise((resolve) => stub.close(resolve));
    }
  });

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const submit = async () => {
    const res = await postWebhook(ctx.server, buildWebhookPayload()).expect(
      202,
    );
    return (res.body as OrderResponseDto).id;
  };

  const finalState = (id: string) =>
    waitFor(
      async () => {
        const order = await getOrder(ctx.server, id);
        return order.status === OrderStatus.ENRICHED ||
          order.status === OrderStatus.FAILED_ENRICHMENT
          ? order
          : null;
      },
      { description: `pedido ${id} chegar a um estado final` },
    );

  it('consulta GET /latest?base=USD&symbols=BRL e grava a cotação devolvida', async () => {
    handler = (_req, res) =>
      json(res, 200, { base: 'USD', date: '2026-10-21', rates: { BRL: 5.5 } });

    const order = await finalState(await submit());

    expect(requests).toEqual(['/v1/latest?base=USD&symbols=BRL']);
    expect(order.status).toBe(OrderStatus.ENRICHED);
    expect(order.enrichment).toMatchObject({
      target_currency: 'BRL',
      exchange_rate: 5.5,
      exchange_rate_date: '2026-10-21',
      converted_total: 658.9, // 119.80 * 5.5
    });
  });

  it('5xx é transitório: retenta e conclui quando a API volta', async () => {
    let hits = 0;
    handler = (_req, res) => {
      hits += 1;
      if (hits < TEST_MAX_ATTEMPTS) return json(res, 503, { error: 'busy' });
      json(res, 200, { date: '2026-10-21', rates: { BRL: 5 } });
    };

    const order = await finalState(await submit());

    expect(order.status).toBe(OrderStatus.ENRICHED);
    expect(order.attempts).toBe(TEST_MAX_ATTEMPTS);
    expect(requests).toHaveLength(TEST_MAX_ATTEMPTS);
  });

  it('5xx permanente: esgota as tentativas e vai para a DLQ', async () => {
    handler = (_req, res) => json(res, 500, { error: 'boom' });

    const id = await submit();
    const order = await finalState(id);

    expect(order.status).toBe(OrderStatus.FAILED_ENRICHMENT);
    expect(order.attempts).toBe(TEST_MAX_ATTEMPTS);
    expect(order.failure_reason).toBe('Exchange API responded with 500');
    expect(requests).toHaveLength(TEST_MAX_ATTEMPTS);
    await waitFor(
      async () => (await ctx.dlq.getJobs(['waiting'])).length === 1,
      {
        description: 'job na orders-dlq',
      },
    );
  });

  it('4xx é permanente: 1 tentativa e DLQ imediata', async () => {
    handler = (_req, res) => json(res, 404, { message: 'not found' });

    const order = await finalState(await submit());

    expect(order.status).toBe(OrderStatus.FAILED_ENRICHMENT);
    expect(order.attempts).toBe(1);
    expect(order.failure_reason).toBe(
      'Exchange API rejected USD->BRL with 404',
    );
    expect(requests).toHaveLength(1);
  });

  it('resposta 200 sem a cotação pedida é permanente: 1 tentativa e DLQ', async () => {
    handler = (_req, res) => json(res, 200, { date: '2026-10-21', rates: {} });

    const order = await finalState(await submit());

    expect(order.status).toBe(OrderStatus.FAILED_ENRICHMENT);
    expect(order.attempts).toBe(1);
    expect(order.failure_reason).toBe('Exchange API has no rate for USD->BRL');
  });

  it('corpo que não é JSON é transitório: usa todas as tentativas antes da DLQ', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html>manutenção</html>');
    };

    const order = await finalState(await submit());

    expect(order.status).toBe(OrderStatus.FAILED_ENRICHMENT);
    expect(order.attempts).toBe(TEST_MAX_ATTEMPTS);
    expect(order.failure_reason).toBe(
      'Exchange API returned an invalid JSON body',
    );
  });

  it('timeout da API é transitório: aborta, retenta e vai para a DLQ ao esgotar', async () => {
    const pending: ServerResponse[] = [];
    handler = (_req, res) => {
      pending.push(res); // nunca responde
    };

    const order = await finalState(await submit());
    pending.forEach((res) => res.destroy());

    expect(order.status).toBe(OrderStatus.FAILED_ENRICHMENT);
    expect(order.attempts).toBe(TEST_MAX_ATTEMPTS);
    expect(order.failure_reason).toMatch(/unreachable or timed out/);
    expect(requests).toHaveLength(TEST_MAX_ATTEMPTS);
  });
});
