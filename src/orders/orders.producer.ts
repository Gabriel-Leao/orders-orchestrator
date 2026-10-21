import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
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
    await this.withTimeout(
      this.queue.add(ENRICH_ORDER_JOB, { orderId }, { jobId: orderId }),
      ENQUEUE_TIMEOUT_MS,
    );
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Redis did not respond within ${ms}ms`)),
        ms,
      );
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }
}
