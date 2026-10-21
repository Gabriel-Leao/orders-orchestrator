export const QUEUE_PREFIX = 'orders-orchestrator';

export const ORDERS_QUEUE = 'orders';

export const ENRICH_ORDER_JOB = 'enrich-order';

export interface EnrichOrderJobData {
  orderId: string;
}
