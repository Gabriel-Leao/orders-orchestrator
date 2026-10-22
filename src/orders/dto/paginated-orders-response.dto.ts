import { ApiProperty } from '@nestjs/swagger';
import { OrderResponseDto } from './order-response.dto';
import type { PaginatedOrders } from '../orders.service';

export class PaginationMetaDto {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

export class PaginatedOrdersResponseDto {
  @ApiProperty({ type: [OrderResponseDto] })
  data: OrderResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;

  static from({
    items,
    total,
    page,
    limit,
  }: PaginatedOrders): PaginatedOrdersResponseDto {
    return {
      data: items.map((order) => OrderResponseDto.fromEntity(order)),
      meta: { page, limit, total, total_pages: Math.ceil(total / limit) },
    };
  }
}
