import type { ConfigService } from '@nestjs/config';
import { FrankfurterExchangeRateClient } from '../../../src/enrichment/clients/frankfurter-exchange-rate.client';
import {
  PermanentEnrichmentError,
  RetryableEnrichmentError,
} from '../../../src/enrichment/enrichment.errors';

const buildClient = (
  url = 'https://api.frankfurter.dev/v1',
  timeoutMs = 5000,
) => {
  const values: Record<string, unknown> = {
    EXCHANGE_API_URL: url,
    EXTERNAL_TIMEOUT_MS: timeoutMs,
  };
  return new FrankfurterExchangeRateClient({
    getOrThrow: (key: string) => values[key],
  } as unknown as ConfigService<never, true>);
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('FrankfurterExchangeRateClient', () => {
  let fetchMock: jest.SpyInstance<Promise<Response>, Parameters<typeof fetch>>;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  describe('requisição', () => {
    it('monta GET {base}/latest?base=FROM&symbols=TO com Accept JSON e timeout', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ date: '2026-10-20', rates: { BRL: 5.4 } }),
      );

      await buildClient().getRate('USD', 'BRL');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(
        'https://api.frankfurter.dev/v1/latest?base=USD&symbols=BRL',
      );
      expect(init?.headers).toEqual({ Accept: 'application/json' });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    });

    it('ignora barras no fim da URL base', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ date: '2026-10-20', rates: { BRL: 5 } }),
      );

      await buildClient('http://localhost:9999/v1///').getRate('USD', 'BRL');

      expect(fetchMock.mock.calls[0][0]).toBe(
        'http://localhost:9999/v1/latest?base=USD&symbols=BRL',
      );
    });

    it('codifica os códigos de moeda na query string', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ rates: {} }));

      await buildClient()
        .getRate('U&D', 'B R')
        .catch(() => undefined);

      expect(fetchMock.mock.calls[0][0]).toContain('base=U%26D&symbols=B%20R');
    });

    it('o signal respeita EXTERNAL_TIMEOUT_MS (aborta a requisição pendente)', async () => {
      fetchMock.mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(init.signal?.reason as Error),
            );
          }),
      );

      const failure = await buildClient('https://x.test/v1', 30)
        .getRate('USD', 'BRL')
        .catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(RetryableEnrichmentError);
      expect((failure as Error).message).toMatch(
        /unreachable or timed out \(TimeoutError/,
      );
    });
  });

  describe('resposta de sucesso', () => {
    it('devolve a taxa e a data informadas pela API', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          base: 'USD',
          date: '2026-10-20',
          rates: { BRL: 5.4321 },
        }),
      );

      await expect(buildClient().getRate('USD', 'BRL')).resolves.toEqual({
        rate: 5.4321,
        date: '2026-10-20',
      });
    });

    it('sem date na resposta, usa a data de hoje', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ rates: { BRL: 5 } }));

      const { date } = await buildClient().getRate('USD', 'BRL');

      expect(date).toBe(new Date().toISOString().slice(0, 10));
    });
  });

  describe('erros transitórios (RetryableEnrichmentError → retry com backoff)', () => {
    it('falha de rede', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      const failure = await buildClient()
        .getRate('USD', 'BRL')
        .catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(RetryableEnrichmentError);
      expect((failure as Error).message).toContain('fetch failed');
      expect((failure as Error).cause).toBeInstanceOf(TypeError);
    });

    it.each([429, 500, 502, 503, 504])('HTTP %i', async (status) => {
      fetchMock.mockResolvedValue(jsonResponse({ error: 'x' }, status));

      const failure = await buildClient()
        .getRate('USD', 'BRL')
        .catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(RetryableEnrichmentError);
      expect((failure as Error).message).toBe(
        `Exchange API responded with ${status}`,
      );
    });

    it('corpo 200 que não é JSON', async () => {
      fetchMock.mockResolvedValue(
        new Response('<html>manutenção</html>', { status: 200 }),
      );

      const failure = await buildClient()
        .getRate('USD', 'BRL')
        .catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(RetryableEnrichmentError);
      expect((failure as Error).message).toBe(
        'Exchange API returned an invalid JSON body',
      );
    });

    it('falha ao descartar o corpo de uma resposta 5xx também é transitória', async () => {
      const response = new Response('x', { status: 503 });
      jest
        .spyOn(response.body as ReadableStream, 'cancel')
        .mockRejectedValue(new Error('stream quebrado'));
      fetchMock.mockResolvedValue(response);

      const failure = await buildClient()
        .getRate('USD', 'BRL')
        .catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(RetryableEnrichmentError);
    });
  });

  describe('erros permanentes (PermanentEnrichmentError → DLQ direto)', () => {
    it.each([400, 401, 403, 404, 422])('HTTP %i', async (status) => {
      fetchMock.mockResolvedValue(jsonResponse({ message: 'x' }, status));

      const failure = await buildClient()
        .getRate('USD', 'XXX')
        .catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(PermanentEnrichmentError);
      expect((failure as Error).message).toBe(
        `Exchange API rejected USD->XXX with ${status}`,
      );
    });

    it.each([
      ['sem o campo rates', {}],
      ['rates sem a moeda pedida', { rates: { EUR: 0.9 } }],
      ['taxa como string', { rates: { BRL: '5.4' } }],
      ['taxa zero', { rates: { BRL: 0 } }],
      ['taxa negativa', { rates: { BRL: -1 } }],
      ['taxa nula', { rates: { BRL: null } }],
    ])('200 com cotação inutilizável: %s', async (_label, body) => {
      fetchMock.mockResolvedValue(jsonResponse(body));

      const failure = await buildClient()
        .getRate('USD', 'BRL')
        .catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(PermanentEnrichmentError);
      expect((failure as Error).message).toBe(
        'Exchange API has no rate for USD->BRL',
      );
    });
  });
});
