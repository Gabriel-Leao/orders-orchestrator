import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ORDERS_QUEUE } from './queue.constants';

@Global()
@Module({
  imports: [BullModule.registerQueue({ name: ORDERS_QUEUE })],
  exports: [BullModule],
})
export class QueueModule {}
