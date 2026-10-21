import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { CreateOrderWebhookDto } from './dto/create-order-webhook.dto';
import {
  ORDER_EXTERNAL_ID_CONSTRAINT,
  ORDER_IDEMPOTENCY_CONSTRAINT,
  Order,
} from './entities/order.entity';
import { OrderStatus } from './enums/order-status.enum';

const PG_UNIQUE_VIOLATION = '23505';

export interface ReceiveOrderResult {
  order: Order;
  created: boolean;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
  ) {}

  async receive(dto: CreateOrderWebhookDto): Promise<ReceiveOrderResult> {
    const existing = await this.findByIdempotencyKey(dto.idempotency_key);
    if (existing) {
      this.logger.log(
        `Replay ignorado idempotencyKey=${dto.idempotency_key} orderId=${existing.id}`,
      );
      return { order: existing, created: false };
    }

    const order = this.orders.create({
      externalOrderId: dto.order_id,
      idempotencyKey: dto.idempotency_key,
      customerEmail: dto.customer.email,
      customerName: dto.customer.name,
      items: dto.items.map((item) => ({
        sku: item.sku,
        qty: item.qty,
        unitPrice: item.unit_price,
      })),
      currency: dto.currency,
      total: this.calculateTotal(dto),
      status: OrderStatus.RECEIVED,
    });

    try {
      const saved = await this.orders.save(order);
      this.logger.log(
        `Pedido recebido orderId=${saved.id} externalOrderId=${saved.externalOrderId}`,
      );
      return { order: saved, created: true };
    } catch (error) {
      return this.handleUniqueViolation(error, dto);
    }
  }

  private calculateTotal(dto: CreateOrderWebhookDto): number {
    const cents = dto.items.reduce(
      (sum, item) => sum + Math.round(item.unit_price * 100) * item.qty,
      0,
    );
    return cents / 100;
  }

  private findByIdempotencyKey(key: string): Promise<Order | null> {
    return this.orders.findOne({ where: { idempotencyKey: key } });
  }

  private async handleUniqueViolation(
    error: unknown,
    dto: CreateOrderWebhookDto,
  ): Promise<ReceiveOrderResult> {
    if (!(error instanceof QueryFailedError)) throw error;

    const driverError = error.driverError as
      { code?: string; constraint?: string } | undefined;
    if (driverError?.code !== PG_UNIQUE_VIOLATION) throw error;

    if (driverError.constraint === ORDER_IDEMPOTENCY_CONSTRAINT) {
      const winner = await this.findByIdempotencyKey(dto.idempotency_key);
      if (winner) {
        this.logger.log(
          `Corrida resolvida idempotencyKey=${dto.idempotency_key} orderId=${winner.id}`,
        );
        return { order: winner, created: false };
      }
    }

    if (driverError.constraint === ORDER_EXTERNAL_ID_CONSTRAINT) {
      throw new ConflictException(
        `order_id "${dto.order_id}" já foi recebido com outra idempotency_key`,
      );
    }

    throw error;
  }
}
