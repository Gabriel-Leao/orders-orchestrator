import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { withTimeout } from '../common/utils/with-timeout';
import {
  QueueMetricsResponseDto,
  QueueSnapshotDto,
} from './dto/queue-metrics-response.dto';
import { ORDERS_DLQ, ORDERS_QUEUE, QUEUE_PREFIX } from './queue.constants';

const METRICS_TIMEOUT_MS = 3000;

@Injectable()
export class QueueMetricsService {
  private readonly logger = new Logger(QueueMetricsService.name);

  constructor(
    @InjectQueue(ORDERS_QUEUE) private readonly ordersQueue: Queue,
    @InjectQueue(ORDERS_DLQ) private readonly deadLetterQueue: Queue,
  ) {}

  async getMetrics(): Promise<QueueMetricsResponseDto> {
    try {
      const [queue, deadLetterQueue] = await withTimeout(
        Promise.all([
          this.snapshot(this.ordersQueue),
          this.snapshot(this.deadLetterQueue),
        ]),
        METRICS_TIMEOUT_MS,
      );
      return {
        prefix: QUEUE_PREFIX,
        queue,
        dead_letter_queue: deadLetterQueue,
      };
    } catch (error) {
      this.logger.error(`Falha ao ler métricas: ${(error as Error).message}`);
      throw new ServiceUnavailableException('Queue backend unavailable');
    }
  }

  private async snapshot(queue: Queue): Promise<QueueSnapshotDto> {
    const [counts, isPaused] = await Promise.all([
      queue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed'),
      queue.isPaused(),
    ]);

    return {
      name: queue.name,
      is_paused: isPaused,
      counts: {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
      },
    };
  }
}
