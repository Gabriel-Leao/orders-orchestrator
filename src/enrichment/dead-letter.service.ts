import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { OrderStatus } from '../orders/enums/order-status.enum';
import { OrdersService } from '../orders/orders.service';
import {
  DEAD_LETTER_JOB,
  DeadLetterJobData,
  ORDERS_DLQ,
} from '../queue/queue.constants';

const MAX_REASON_LENGTH = 500;

export interface BuryInput {
  orderId: string;
  reason: string;
  attempts: number;
}

@Injectable()
export class DeadLetterService {
  private readonly logger = new Logger(DeadLetterService.name);

  constructor(
    @InjectQueue(ORDERS_DLQ) private readonly dlq: Queue<DeadLetterJobData>,
    private readonly orders: OrdersService,
  ) {}

  async bury({ orderId, reason, attempts }: BuryInput): Promise<void> {
    const failureReason = reason.slice(0, MAX_REASON_LENGTH);

    try {
      await this.dlq.add(
        DEAD_LETTER_JOB,
        {
          orderId,
          reason: failureReason,
          attempts,
          failedAt: new Date().toISOString(),
        },
        { jobId: orderId },
      );
    } catch (error) {
      this.logger.error(
        `orderId=${orderId} não pôde ser registrado na DLQ: ${(error as Error).message}`,
      );
    }

    const updated = await this.orders.transition(
      orderId,
      OrderStatus.FAILED_ENRICHMENT,
      { failureReason },
    );

    if (updated) {
      this.logger.error(
        `orderId=${orderId} enviado para a DLQ após ${attempts} tentativa(s): ${failureReason}`,
      );
    } else {
      this.logger.warn(
        `orderId=${orderId} não pôde ir para FAILED_ENRICHMENT (status já mudou)`,
      );
    }
  }
}
