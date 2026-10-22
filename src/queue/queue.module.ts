import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { QueueMetricsController } from './queue-metrics.controller';
import { QueueMetricsService } from './queue-metrics.service';
import { ORDERS_DLQ, ORDERS_QUEUE } from './queue.constants';

@Global()
@Module({
  imports: [
    BullModule.registerQueue({ name: ORDERS_QUEUE }, { name: ORDERS_DLQ }),
  ],
  controllers: [QueueMetricsController],
  providers: [QueueMetricsService],
  exports: [BullModule],
})
export class QueueModule {}
