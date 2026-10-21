import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { EnrichmentProcessor } from './enrichment.processor';
import { EnrichmentService } from './enrichment.service';

@Module({
  imports: [OrdersModule],
  providers: [EnrichmentService, EnrichmentProcessor],
})
export class EnrichmentModule {}
