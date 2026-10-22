import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { EnrichOrderJobData, ORDERS_QUEUE } from '../queue/queue.constants';
import { DeadLetterService } from './dead-letter.service';
import { PermanentEnrichmentError } from './enrichment.errors';
import { EnrichmentService } from './enrichment.service';

@Processor(ORDERS_QUEUE, { concurrency: 5 })
export class EnrichmentProcessor extends WorkerHost {
  private readonly logger = new Logger(EnrichmentProcessor.name);

  constructor(
    private readonly enrichment: EnrichmentService,
    private readonly deadLetter: DeadLetterService,
  ) {
    super();
  }

  async process(job: Job<EnrichOrderJobData>): Promise<void> {
    const { orderId } = job.data;
    this.logger.log(
      `job=${job.id} orderId=${orderId} tentativa=${job.attemptsMade + 1}`,
    );

    try {
      await this.enrichment.enrich(orderId);
    } catch (error) {
      if (error instanceof PermanentEnrichmentError) {
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<EnrichOrderJobData> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) return;
    const { orderId } = job.data;

    try {
      if (!(await this.isFinalFailure(job, error))) {
        this.logger.warn(
          `job=${job.id} orderId=${orderId} falhou (tentativa ${job.attemptsMade}); será retentado: ${error.message}`,
        );
        return;
      }

      await this.deadLetter.bury({
        orderId,
        reason: error.message,
        attempts: job.attemptsMade,
      });
    } catch (handlerError) {
      this.logger.error(
        `job=${job.id} orderId=${orderId} falha ao tratar o erro do job: ${(handlerError as Error).message}`,
      );
    }
  }

  private async isFinalFailure(
    job: Job<EnrichOrderJobData>,
    error: Error,
  ): Promise<boolean> {
    if (error instanceof UnrecoverableError) return true;
    if (job.attemptsMade >= (job.opts.attempts ?? 1)) return true;
    return (await job.getState()) === 'failed';
  }
}
