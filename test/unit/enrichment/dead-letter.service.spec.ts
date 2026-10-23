import type { Queue } from 'bullmq';
import { DeadLetterService } from '../../../src/enrichment/dead-letter.service';
import { OrderStatus } from '../../../src/orders/enums/order-status.enum';
import type { OrdersService } from '../../../src/orders/orders.service';
import {
  DEAD_LETTER_JOB,
  type DeadLetterJobData,
} from '../../../src/queue/queue.constants';

describe('DeadLetterService.bury', () => {
  const add = jest.fn();
  const transition = jest.fn();
  const service = new DeadLetterService(
    { add } as unknown as Queue<DeadLetterJobData>,
    { transition } as unknown as OrdersService,
  );

  beforeEach(() => {
    add.mockResolvedValue(undefined);
    transition.mockResolvedValue(true);
  });

  it('registra o job na DLQ com jobId = orderId e os dados da falha', async () => {
    await service.bury({
      orderId: 'order-1',
      reason: 'API fora do ar',
      attempts: 5,
    });

    expect(add).toHaveBeenCalledWith(
      DEAD_LETTER_JOB,
      {
        orderId: 'order-1',
        reason: 'API fora do ar',
        attempts: 5,
        failedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/) as string,
      },
      { jobId: 'order-1' },
    );
  });

  it('marca o pedido como FAILED_ENRICHMENT gravando failure_reason', async () => {
    await service.bury({
      orderId: 'order-1',
      reason: 'API fora do ar',
      attempts: 5,
    });

    expect(transition).toHaveBeenCalledWith(
      'order-1',
      OrderStatus.FAILED_ENRICHMENT,
      {
        failureReason: 'API fora do ar',
      },
    );
  });

  it('trunca o motivo em 500 caracteres na DLQ e no banco', async () => {
    const longReason = 'e'.repeat(800);

    await service.bury({ orderId: 'order-1', reason: longReason, attempts: 3 });

    const jobData = (add.mock.calls[0] as [string, { reason: string }])[1];
    expect(jobData.reason).toHaveLength(500);
    expect(transition).toHaveBeenCalledWith(
      'order-1',
      OrderStatus.FAILED_ENRICHMENT,
      { failureReason: 'e'.repeat(500) },
    );
  });

  it('mesmo se a DLQ falhar, o status do pedido ainda é atualizado', async () => {
    add.mockRejectedValue(new Error('Redis fora'));

    await expect(
      service.bury({ orderId: 'order-1', reason: 'x', attempts: 5 }),
    ).resolves.toBeUndefined();

    expect(transition).toHaveBeenCalledWith(
      'order-1',
      OrderStatus.FAILED_ENRICHMENT,
      expect.anything(),
    );
  });

  it('não lança quando o pedido já mudou de status (transição recusada)', async () => {
    transition.mockResolvedValue(false);

    await expect(
      service.bury({ orderId: 'order-1', reason: 'x', attempts: 5 }),
    ).resolves.toBeUndefined();
  });
});
