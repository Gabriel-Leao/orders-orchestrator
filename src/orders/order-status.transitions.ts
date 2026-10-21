import { OrderStatus } from './enums/order-status.enum';

export const ORDER_STATUS_TRANSITIONS: Readonly<
  Record<OrderStatus, readonly OrderStatus[]>
> = {
  [OrderStatus.RECEIVED]: [OrderStatus.PROCESSING],
  [OrderStatus.PROCESSING]: [
    OrderStatus.PROCESSING,
    OrderStatus.ENRICHED,
    OrderStatus.FAILED_ENRICHMENT,
  ],
  [OrderStatus.ENRICHED]: [],
  [OrderStatus.FAILED_ENRICHMENT]: [],
};

export const canTransition = (from: OrderStatus, to: OrderStatus): boolean =>
  ORDER_STATUS_TRANSITIONS[from].includes(to);

export const allowedSources = (to: OrderStatus): OrderStatus[] =>
  Object.values(OrderStatus).filter((from) => canTransition(from, to));
