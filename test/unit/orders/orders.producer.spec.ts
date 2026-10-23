import type { Queue } from 'bullmq';
import {
  ENQUEUE_TIMEOUT_MS,
  OrdersProducer,
} from '../../../src/orders/orders.producer';
import {
  ENRICH_ORDER_JOB,
  type EnrichOrderJobData,
} from '../../../src/queue/queue.constants';

describe('OrdersProducer', () => {
  const add = jest.fn();
  const producer = new OrdersProducer({
    add,
  } as unknown as Queue<EnrichOrderJobData>);

  afterEach(() => jest.useRealTimers());

  it('enfileira o job de enriquecimento com jobId = id do pedido (dedupe no BullMQ)', async () => {
    add.mockResolvedValue({ id: 'order-1' });

    await producer.enqueueEnrichment('order-1');

    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      ENRICH_ORDER_JOB,
      { orderId: 'order-1' },
      { jobId: 'order-1' },
    );
  });

  it('propaga o erro quando o Redis rejeita o job', async () => {
    add.mockRejectedValue(new Error('Connection is closed'));

    await expect(producer.enqueueEnrichment('order-1')).rejects.toThrow(
      'Connection is closed',
    );
  });

  it('desiste após 3 s quando o Redis não responde (em vez de ficar preso na fila offline)', async () => {
    jest.useFakeTimers();
    add.mockReturnValue(new Promise(() => undefined));

    const result = producer.enqueueEnrichment('order-1');
    const assertion = expect(result).rejects.toThrow(
      `Redis did not respond within ${ENQUEUE_TIMEOUT_MS}ms`,
    );
    await jest.advanceTimersByTimeAsync(ENQUEUE_TIMEOUT_MS);

    await assertion;
    expect(ENQUEUE_TIMEOUT_MS).toBe(3000);
  });
});
