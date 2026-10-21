import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ApiKeyGuard } from './common/guards/api-key.guard';
import { AppDatabaseModule } from './config/database.config';
import { validateEnv } from './config/env.validation';
import { AppLoggerModule } from './config/logger.config';
import { AppQueueModule } from './config/queue.config';
import { EnrichmentModule } from './enrichment/enrichment.module';
import { HealthController } from './health/health.controller';
import { OrdersModule } from './orders/orders.module';
import { QueueModule } from './queue/queue.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    AppLoggerModule,
    AppDatabaseModule,
    AppQueueModule,
    QueueModule,
    OrdersModule,
    EnrichmentModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ApiKeyGuard }],
})
export class AppModule {}
