import { ServiceUnavailableException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QueueMetricsService } from '../../../src/queue/queue-metrics.service';
import {
  ORDERS_DLQ,
  ORDERS_QUEUE,
  QUEUE_PREFIX,
} from '../../../src/queue/queue.constants';

const fakeQueue = (name: string) => ({
  name,
  getJobCounts: jest.fn(),
  isPaused: jest.fn().mockResolvedValue(false),
});

describe('QueueMetricsService', () => {
  const ordersQueue = fakeQueue(ORDERS_QUEUE);
  const dlq = fakeQueue(ORDERS_DLQ);
  const service = new QueueMetricsService(
    ordersQueue as unknown as Queue,
    dlq as unknown as Queue,
  );

  afterEach(() => jest.useRealTimers());

  it('monta o snapshot das duas filas com nome, pausa e contadores', async () => {
    ordersQueue.getJobCounts.mockResolvedValue({
      waiting: 1,
      active: 2,
      delayed: 3,
      completed: 4,
      failed: 5,
    });
    dlq.getJobCounts.mockResolvedValue({
      waiting: 7,
      active: 0,
      delayed: 0,
      completed: 0,
      failed: 0,
    });
    dlq.isPaused.mockResolvedValue(true);

    await expect(service.getMetrics()).resolves.toEqual({
      prefix: QUEUE_PREFIX,
      queue: {
        name: ORDERS_QUEUE,
        is_paused: false,
        counts: { waiting: 1, active: 2, delayed: 3, completed: 4, failed: 5 },
      },
      dead_letter_queue: {
        name: ORDERS_DLQ,
        is_paused: true,
        counts: { waiting: 7, active: 0, delayed: 0, completed: 0, failed: 0 },
      },
    });
  });

  it('pede ao BullMQ exatamente os estados expostos na API', async () => {
    ordersQueue.getJobCounts.mockResolvedValue({});
    dlq.getJobCounts.mockResolvedValue({});

    await service.getMetrics();

    expect(ordersQueue.getJobCounts).toHaveBeenCalledWith(
      'waiting',
      'active',
      'delayed',
      'completed',
      'failed',
    );
  });

  it('contadores ausentes na resposta do BullMQ viram 0', async () => {
    ordersQueue.getJobCounts.mockResolvedValue({ waiting: 3 });
    dlq.getJobCounts.mockResolvedValue({});

    const metrics = await service.getMetrics();

    expect(metrics.queue.counts).toEqual({
      waiting: 3,
      active: 0,
      delayed: 0,
      completed: 0,
      failed: 0,
    });
  });

  it('responde 503 quando o Redis falha', async () => {
    ordersQueue.getJobCounts.mockRejectedValue(new Error('ECONNREFUSED'));
    dlq.getJobCounts.mockResolvedValue({});

    await expect(service.getMetrics()).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('responde 503 quando o Redis não responde em 3 s', async () => {
    jest.useFakeTimers();
    ordersQueue.getJobCounts.mockReturnValue(new Promise(() => undefined));
    dlq.getJobCounts.mockResolvedValue({});

    const result = service.getMetrics();
    const assertion = expect(result).rejects.toThrow(
      ServiceUnavailableException,
    );
    await jest.advanceTimersByTimeAsync(3000);

    await assertion;
  });
});
