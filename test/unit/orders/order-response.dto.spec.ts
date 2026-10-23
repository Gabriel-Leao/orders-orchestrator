import { OrderResponseDto } from '../../../src/orders/dto/order-response.dto';
import { PaginatedOrdersResponseDto } from '../../../src/orders/dto/paginated-orders-response.dto';
import { OrderStatus } from '../../../src/orders/enums/order-status.enum';
import { buildOrder } from '../../support/order-factory';

describe('OrderResponseDto.fromEntity', () => {
  it('mapeia a entity (camelCase) para o contrato público em snake_case', () => {
    const order = buildOrder({
      items: [
        { sku: 'A', qty: 1, unitPrice: 10 },
        { sku: 'B', qty: 3, unitPrice: 2.5 },
      ],
      attempts: 2,
    });

    expect(OrderResponseDto.fromEntity(order)).toEqual({
      id: order.id,
      order_id: 'ext-123',
      status: OrderStatus.RECEIVED,
      customer: { email: 'user@example.com', name: 'Ana' },
      items: [
        { sku: 'A', qty: 1, unit_price: 10 },
        { sku: 'B', qty: 3, unit_price: 2.5 },
      ],
      currency: 'USD',
      total: 119.8,
      enrichment: null,
      failure_reason: null,
      attempts: 2,
      created_at: order.createdAt,
      updated_at: order.updatedAt,
    });
  });

  it('não vaza campos internos (idempotency_key, external_order_id camelCase)', () => {
    const body = OrderResponseDto.fromEntity(buildOrder());

    expect(body).not.toHaveProperty('idempotencyKey');
    expect(body).not.toHaveProperty('idempotency_key');
    expect(body).not.toHaveProperty('externalOrderId');
  });

  it('inclui o bloco enrichment quando há cotação gravada', () => {
    const enrichedAt = new Date('2026-10-20T12:00:00Z');
    const order = buildOrder({
      status: OrderStatus.ENRICHED,
      targetCurrency: 'BRL',
      convertedTotal: 628.95,
      exchangeRate: 5.25,
      exchangeRateDate: '2026-10-20',
      enrichedAt,
    });

    expect(OrderResponseDto.fromEntity(order).enrichment).toEqual({
      target_currency: 'BRL',
      converted_total: 628.95,
      exchange_rate: 5.25,
      exchange_rate_date: '2026-10-20',
      enriched_at: enrichedAt,
    });
  });

  it('enrichment é null enquanto o pedido não foi enriquecido, mesmo com failure_reason', () => {
    const order = buildOrder({
      status: OrderStatus.FAILED_ENRICHMENT,
      failureReason: 'API fora do ar',
    });

    const body = OrderResponseDto.fromEntity(order);

    expect(body.enrichment).toBeNull();
    expect(body.failure_reason).toBe('API fora do ar');
  });

  it('um total convertido igual a 0 ainda conta como enriquecido', () => {
    const order = buildOrder({
      status: OrderStatus.ENRICHED,
      targetCurrency: 'BRL',
      convertedTotal: 0,
      exchangeRate: 1,
      exchangeRateDate: '2026-10-20',
      enrichedAt: new Date(),
    });

    expect(OrderResponseDto.fromEntity(order).enrichment).not.toBeNull();
  });
});

describe('PaginatedOrdersResponseDto.from', () => {
  const items = [buildOrder()];

  it.each([
    [0, 20, 0],
    [1, 20, 1],
    [20, 20, 1],
    [21, 20, 2],
    [41, 10, 5],
  ])('total=%i limit=%i → total_pages=%i', (total, limit, totalPages) => {
    const body = PaginatedOrdersResponseDto.from({
      items,
      total,
      page: 1,
      limit,
    });

    expect(body.meta).toEqual({
      page: 1,
      limit,
      total,
      total_pages: totalPages,
    });
  });

  it('converte cada pedido para o contrato público', () => {
    const body = PaginatedOrdersResponseDto.from({
      items,
      total: 1,
      page: 1,
      limit: 20,
    });

    expect(body.data).toEqual([OrderResponseDto.fromEntity(items[0])]);
  });
});
