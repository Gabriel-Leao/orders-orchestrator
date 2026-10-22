import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.validation';
import { OrderStatus } from '../orders/enums/order-status.enum';
import { OrdersService } from '../orders/orders.service';
import { EXCHANGE_RATE_CLIENT } from './clients/exchange-rate.client';
import type {
  ExchangeRate,
  ExchangeRateClient,
} from './clients/exchange-rate.client';
import { OrderNotFoundError } from './enrichment.errors';

export const convertAmount = (amount: number, rate: number): number =>
  Math.round(Math.round(amount * 100) * rate) / 100;

@Injectable()
export class EnrichmentService {
  private readonly logger = new Logger(EnrichmentService.name);
  private readonly targetCurrency: string;

  constructor(
    private readonly orders: OrdersService,
    @Inject(EXCHANGE_RATE_CLIENT)
    private readonly exchange: ExchangeRateClient,
    config: ConfigService<Env, true>,
  ) {
    this.targetCurrency = config.getOrThrow<string>('TARGET_CURRENCY');
  }

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

    const { rate, date } = await this.resolveRate(order.currency);

    const finished = await this.orders.transition(
      orderId,
      OrderStatus.ENRICHED,
      {
        targetCurrency: this.targetCurrency,
        convertedTotal: convertAmount(order.total, rate),
        exchangeRate: rate,
        exchangeRateDate: date,
        enrichedAt: new Date(),
      },
    );
    if (!finished) {
      this.logger.warn(`orderId=${orderId} não pôde ir para ENRICHED`);
      return;
    }

    this.logger.log(
      `orderId=${orderId} enriquecido (${order.currency}->${this.targetCurrency} @ ${rate})`,
    );
  }

  private async resolveRate(currency: string): Promise<ExchangeRate> {
    if (currency === this.targetCurrency) {
      return { rate: 1, date: new Date().toISOString().slice(0, 10) };
    }
    return this.exchange.getRate(currency, this.targetCurrency);
  }
}
