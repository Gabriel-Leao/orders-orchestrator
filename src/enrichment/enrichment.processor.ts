import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { EnrichOrderJobData, ORDERS_QUEUE } from '../queue/queue.constants';
import { EnrichmentService, OrderNotFoundError } from './enrichment.service';

@Processor(ORDERS_QUEUE, { concurrency: 5 })
export class EnrichmentProcessor extends WorkerHost {
  private readonly logger = new Logger(EnrichmentProcessor.name);

  constructor(private readonly enrichment: EnrichmentService) {
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
      if (error instanceof OrderNotFoundError) {
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<EnrichOrderJobData> | undefined, error: Error): void {
    this.logger.warn(
      `job=${job?.id} orderId=${job?.data.orderId} falhou (tentativa ${job?.attemptsMade}): ${error.message}`,
    );
  }
}
