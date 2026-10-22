import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './entities/order.entity';
import { OrdersController } from './orders.controller';
import { OrdersProducer } from './orders.producer';
import { OrdersService } from './orders.service';
import { WebhooksController } from './webhooks/webhooks.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Order])],
  controllers: [WebhooksController, OrdersController],
  providers: [OrdersService, OrdersProducer],
  exports: [OrdersService],
})
export class OrdersModule {}
