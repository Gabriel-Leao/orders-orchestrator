export const QUEUE_PREFIX = 'orders-orchestrator';

export const ORDERS_QUEUE = 'orders';

export const ENRICH_ORDER_JOB = 'enrich-order';

export interface EnrichOrderJobData {
  orderId: string;
}

export const ORDERS_DLQ = 'orders-dlq';

export const DEAD_LETTER_JOB = 'dead-letter-order';

export interface DeadLetterJobData {
  orderId: string;
  reason: string;
  attempts: number;
  failedAt: string;
}
