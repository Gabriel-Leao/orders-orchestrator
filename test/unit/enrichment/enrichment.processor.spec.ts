import { type Job, UnrecoverableError } from 'bullmq';
import type { DeadLetterService } from '../../../src/enrichment/dead-letter.service';
import {
  OrderNotFoundError,
  PermanentEnrichmentError,
  RetryableEnrichmentError,
} from '../../../src/enrichment/enrichment.errors';
import { EnrichmentProcessor } from '../../../src/enrichment/enrichment.processor';
import type { EnrichmentService } from '../../../src/enrichment/enrichment.service';
import type { EnrichOrderJobData } from '../../../src/queue/queue.constants';

type FakeJob = Job<EnrichOrderJobData>;

const buildJob = (
  overrides: {
    attemptsMade?: number;
    attempts?: number | undefined;
    state?: string;
  } = {},
): FakeJob =>
  ({
    id: 'order-1',
    data: { orderId: 'order-1' },
    attemptsMade: overrides.attemptsMade ?? 1,
    opts: { attempts: 'attempts' in overrides ? overrides.attempts : 5 },
    getState: jest.fn().mockResolvedValue(overrides.state ?? 'delayed'),
  }) as unknown as FakeJob;

describe('EnrichmentProcessor', () => {
  const enrich = jest.fn();
  const bury = jest.fn();
  const processor = new EnrichmentProcessor(
    { enrich } as unknown as EnrichmentService,
    { bury } as unknown as DeadLetterService,
  );

  beforeEach(() => {
    enrich.mockResolvedValue(undefined);
    bury.mockResolvedValue(undefined);
  });

  describe('process', () => {
    it('delega o enriquecimento ao service com o orderId do job', async () => {
      await processor.process(buildJob());

      expect(enrich).toHaveBeenCalledWith('order-1');
    });

    it('erro transitório é relançado como está (o BullMQ aplica retry/backoff)', async () => {
      const error = new RetryableEnrichmentError('timeout');
      enrich.mockRejectedValue(error);

      const failure = await processor
        .process(buildJob())
        .catch((e: unknown) => e);

      expect(failure).toBe(error);
      expect(failure).not.toBeInstanceOf(UnrecoverableError);
    });

    it.each([
      [
        'PermanentEnrichmentError',
        new PermanentEnrichmentError('moeda inválida'),
      ],
      ['OrderNotFoundError', new OrderNotFoundError('order-1')],
    ])(
      '%s vira UnrecoverableError (sem consumir tentativas)',
      async (_name, error) => {
        enrich.mockRejectedValue(error);

        const failure = await processor
          .process(buildJob())
          .catch((e: unknown) => e);

        expect(failure).toBeInstanceOf(UnrecoverableError);
        expect((failure as Error).message).toBe(error.message);
      },
    );

    it('erro desconhecido (bug) é tratado como transitório: relançado sem conversão', async () => {
      const error = new TypeError('undefined is not a function');
      enrich.mockRejectedValue(error);

      await expect(processor.process(buildJob())).rejects.toBe(error);
    });
  });

  describe('onFailed (decide se o job vai para a DLQ)', () => {
    it('ignora o evento quando o job é undefined', async () => {
      await processor.onFailed(undefined, new Error('x'));

      expect(bury).not.toHaveBeenCalled();
    });

    it('tentativas restantes: não envia para a DLQ (haverá retry)', async () => {
      const job = buildJob({ attemptsMade: 2, attempts: 5, state: 'delayed' });

      await processor.onFailed(job, new RetryableEnrichmentError('timeout'));

      expect(bury).not.toHaveBeenCalled();
    });

    it('última tentativa esgotada (attemptsMade >= attempts): envia para a DLQ com o motivo', async () => {
      const job = buildJob({ attemptsMade: 5, attempts: 5 });

      await processor.onFailed(
        job,
        new RetryableEnrichmentError('API fora do ar'),
      );

      expect(bury).toHaveBeenCalledWith({
        orderId: 'order-1',
        reason: 'API fora do ar',
        attempts: 5,
      });
    });

    it('UnrecoverableError vai para a DLQ já na 1ª tentativa', async () => {
      const job = buildJob({ attemptsMade: 1, attempts: 5, state: 'delayed' });

      await processor.onFailed(job, new UnrecoverableError('4xx do serviço'));

      expect(bury).toHaveBeenCalledWith({
        orderId: 'order-1',
        reason: '4xx do serviço',
        attempts: 1,
      });
    });

    it('job que o BullMQ já marcou como failed vai para a DLQ mesmo sem bater o contador', async () => {
      const job = buildJob({ attemptsMade: 2, attempts: 5, state: 'failed' });

      await processor.onFailed(job, new Error('x'));

      expect(bury).toHaveBeenCalledTimes(1);
    });

    it('job sem opts.attempts conta como 1 tentativa: a primeira falha já é definitiva', async () => {
      const job = buildJob({ attemptsMade: 1, attempts: undefined });

      await processor.onFailed(job, new Error('x'));

      expect(bury).toHaveBeenCalledTimes(1);
    });

    it('falha ao enterrar não derruba o worker (erro engolido e logado)', async () => {
      bury.mockRejectedValue(new Error('DLQ indisponível'));
      const job = buildJob({ attemptsMade: 5, attempts: 5 });

      await expect(
        processor.onFailed(job, new Error('x')),
      ).resolves.toBeUndefined();
    });
  });
});
