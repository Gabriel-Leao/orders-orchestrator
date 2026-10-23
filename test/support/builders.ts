import { randomUUID } from 'node:crypto';

export type WebhookPayload = {
  order_id: string;
  customer: { email: string; name: string };
  items: Array<{ sku: string; qty: number; unit_price: number }>;
  currency: string;
  idempotency_key: string;
};

/** Payload válido e único por chamada (order_id e idempotency_key novos). */
export function buildWebhookPayload(
  overrides: Partial<WebhookPayload> = {},
): WebhookPayload {
  return {
    order_id: `ext-${randomUUID()}`,
    customer: { email: 'user@example.com', name: 'Ana' },
    items: [{ sku: 'ABC123', qty: 2, unit_price: 59.9 }],
    currency: 'USD',
    idempotency_key: randomUUID(),
    ...overrides,
  };
}
