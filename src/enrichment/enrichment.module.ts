import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { EXCHANGE_RATE_CLIENT } from './clients/exchange-rate.client';
import { FrankfurterExchangeRateClient } from './clients/frankfurter-exchange-rate.client';
import { DeadLetterService } from './dead-letter.service';
import { EnrichmentProcessor } from './enrichment.processor';
import { EnrichmentService } from './enrichment.service';

@Module({
  imports: [OrdersModule],
  providers: [
    EnrichmentService,
    EnrichmentProcessor,
    DeadLetterService,
    { provide: EXCHANGE_RATE_CLIENT, useClass: FrankfurterExchangeRateClient },
  ],
})
export class EnrichmentModule {}
