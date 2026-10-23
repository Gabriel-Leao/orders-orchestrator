import { Order } from '../../src/orders/entities/order.entity';
import { OrderStatus } from '../../src/orders/enums/order-status.enum';

/** Entity em memória (sem banco) para os testes unitários. */
export function buildOrder(overrides: Partial<Order> = {}): Order {
  return Object.assign(new Order(), {
    id: '0b6f6d8e-5c0f-4a58-9d6e-2f5a3f6f7a10',
    externalOrderId: 'ext-123',
    idempotencyKey: '3f6c1c1e-8a4b-4a52-9d3e-0f9d2b1a7c10',
    customerEmail: 'user@example.com',
    customerName: 'Ana',
    items: [{ sku: 'ABC123', qty: 2, unitPrice: 59.9 }],
    currency: 'USD',
    total: 119.8,
    status: OrderStatus.RECEIVED,
    targetCurrency: null,
    convertedTotal: null,
    exchangeRate: null,
    exchangeRateDate: null,
    enrichedAt: null,
    failureReason: null,
    attempts: 0,
    createdAt: new Date('2026-10-20T10:00:00Z'),
    updatedAt: new Date('2026-10-20T10:00:00Z'),
    ...overrides,
  });
}
