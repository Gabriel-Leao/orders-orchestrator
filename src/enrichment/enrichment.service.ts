import { Injectable, Logger } from '@nestjs/common';
import { OrderStatus } from '../orders/enums/order-status.enum';
import { OrdersService } from '../orders/orders.service';

export class OrderNotFoundError extends Error {
  constructor(orderId: string) {
    super(`Order ${orderId} not found`);
    this.name = 'OrderNotFoundError';
  }
}

@Injectable()
export class EnrichmentService {
  private readonly logger = new Logger(EnrichmentService.name);

  constructor(private readonly orders: OrdersService) {}

  async enrich(orderId: string): Promise<void> {
    const order = await this.orders.findById(orderId);
    if (!order) throw new OrderNotFoundError(orderId);

    if (
      order.status === OrderStatus.ENRICHED ||
      order.status === OrderStatus.FAILED_ENRICHMENT
    ) {
      this.logger.warn(
        `orderId=${orderId} já finalizado (${order.status}); job ignorado`,
      );
      return;
    }

    const started = await this.orders.transition(
      orderId,
      OrderStatus.PROCESSING,
      { attempts: () => 'attempts + 1' },
    );
    if (!started) {
      this.logger.warn(`orderId=${orderId} mudou de status; job ignorado`);
      return;
    }

    const finished = await this.orders.transition(
      orderId,
      OrderStatus.ENRICHED,
      { enrichedAt: new Date() },
    );
    if (!finished) {
      this.logger.warn(`orderId=${orderId} não pôde ir para ENRICHED`);
      return;
    }

    this.logger.log(`orderId=${orderId} enriquecido`);
  }
}
