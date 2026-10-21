import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './entities/order.entity';
import { OrdersService } from './orders.service';
import { WebhooksController } from './webhooks/webhooks.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Order])],
  controllers: [WebhooksController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
