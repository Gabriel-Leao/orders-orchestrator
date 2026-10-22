import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { withTimeout } from '../common/utils/with-timeout';
import {
  ENRICH_ORDER_JOB,
  EnrichOrderJobData,
  ORDERS_QUEUE,
} from '../queue/queue.constants';

export const ENQUEUE_TIMEOUT_MS = 3000;

@Injectable()
export class OrdersProducer {
  constructor(
    @InjectQueue(ORDERS_QUEUE)
    private readonly queue: Queue<EnrichOrderJobData>,
  ) {}

  async enqueueEnrichment(orderId: string): Promise<void> {
    await withTimeout(
      this.queue.add(ENRICH_ORDER_JOB, { orderId }, { jobId: orderId }),
      ENQUEUE_TIMEOUT_MS,
    );
  }
}
