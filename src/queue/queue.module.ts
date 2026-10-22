import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ORDERS_DLQ, ORDERS_QUEUE } from './queue.constants';

@Global()
@Module({
  imports: [
    BullModule.registerQueue({ name: ORDERS_QUEUE }, { name: ORDERS_DLQ }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
