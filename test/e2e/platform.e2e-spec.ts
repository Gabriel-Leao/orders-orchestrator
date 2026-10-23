import request from 'supertest';
import { type TestContext, createTestApp } from '../support/test-app';

describe('Plataforma: health, Swagger e cabeçalhos de segurança', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('GET /health é público e confirma o banco', async () => {
    const res = await request(ctx.server).get('/health').expect(200);

    expect(res.body).toEqual({ status: 'ok', database: 'up' });
  });

  it('GET /health devolve 503 quando o banco não responde', async () => {
    jest
      .spyOn(ctx.dataSource, 'query')
      .mockRejectedValueOnce(new Error('down'));

    const res = await request(ctx.server).get('/health');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error', database: 'down' });
  });

  it('rotas de negócio não são públicas: 401 sem API key', async () => {
    await request(ctx.server).get('/orders').expect(401);
    await request(ctx.server).get('/queue/metrics').expect(401);
    await request(ctx.server).post('/webhooks/orders').send({}).expect(401);
  });

  it('o Swagger (/docs e /docs/json) é público e documenta os endpoints do desafio', async () => {
    await request(ctx.server).get('/docs').expect(200);

    const res = await request(ctx.server).get('/docs/json').expect(200);
    const doc = res.body as {
      paths: Record<string, unknown>;
      components: { securitySchemes: Record<string, unknown> };
    };
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/webhooks/orders',
        '/orders',
        '/orders/{id}',
        '/queue/metrics',
      ]),
    );
    expect(doc.components.securitySchemes).toHaveProperty('api-key');
  });

  it('aplica helmet na API (com CSP) e libera a CSP somente em /docs', async () => {
    const api = await request(ctx.server).get('/health');
    const docs = await request(ctx.server).get('/docs');

    expect(api.headers['x-content-type-options']).toBe('nosniff');
    expect(api.headers['content-security-policy']).toBeDefined();
    expect(docs.headers['content-security-policy']).toBeUndefined();
  });
});
