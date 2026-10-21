import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Order } from '../entities/order.entity';
import { OrderStatus } from '../enums/order-status.enum';

class OrderItemResponseDto {
  sku: string;
  qty: number;
  unit_price: number;
}

class CustomerResponseDto {
  email: string;
  name: string;
}

class EnrichmentResponseDto {
  target_currency: string;
  converted_total: number;
  exchange_rate: number;
  exchange_rate_date: string;
  enriched_at: Date;
}

export class OrderResponseDto {
  id: string;
  order_id: string;

  @ApiProperty({ enum: OrderStatus })
  status: OrderStatus;

  customer: CustomerResponseDto;

  @ApiProperty({ type: [OrderItemResponseDto] })
  items: OrderItemResponseDto[];

  currency: string;
  total: number;

  @ApiPropertyOptional({ type: EnrichmentResponseDto, nullable: true })
  enrichment: EnrichmentResponseDto | null;

  @ApiPropertyOptional({ nullable: true })
  failure_reason: string | null;

  attempts: number;
  created_at: Date;
  updated_at: Date;

  static fromEntity(order: Order): OrderResponseDto {
    const enriched =
      order.convertedTotal !== null && order.targetCurrency !== null;

    return {
      id: order.id,
      order_id: order.externalOrderId,
      status: order.status,
      customer: { email: order.customerEmail, name: order.customerName },
      items: order.items.map((item) => ({
        sku: item.sku,
        qty: item.qty,
        unit_price: item.unitPrice,
      })),
      currency: order.currency,
      total: order.total,
      enrichment: enriched
        ? {
            target_currency: order.targetCurrency as string,
            converted_total: order.convertedTotal as number,
            exchange_rate: order.exchangeRate as number,
            exchange_rate_date: order.exchangeRateDate as string,
            enriched_at: order.enrichedAt as Date,
          }
        : null,
      failure_reason: order.failureReason,
      attempts: order.attempts,
      created_at: order.createdAt,
      updated_at: order.updatedAt,
    };
  }
}
