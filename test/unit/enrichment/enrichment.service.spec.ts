import type { ConfigService } from '@nestjs/config';
import type { ExchangeRateClient } from '../../../src/enrichment/clients/exchange-rate.client';
import {
  OrderNotFoundError,
  RetryableEnrichmentError,
} from '../../../src/enrichment/enrichment.errors';
import {
  EnrichmentService,
  convertAmount,
} from '../../../src/enrichment/enrichment.service';
import { OrderStatus } from '../../../src/orders/enums/order-status.enum';
import type { OrdersService } from '../../../src/orders/orders.service';
import { buildOrder } from '../../support/order-factory';

describe('convertAmount', () => {
  it.each([
    [100, 5.25, 525],
    [119.8, 5.25, 628.95],
    [19.99, 5.5, 109.95], // 1999 * 5.5 = 10994.5 → arredonda para 10995 centavos
    [0.3, 2, 0.6], // 0.1 + 0.2 em float não vira 0.6000000000000001
    [0.01, 5.5, 0.06], // 1 centavo * 5.5 = 5.5 → 6 centavos
    [59.9, 1, 59.9], // taxa 1 preserva o valor
    [0, 5, 0],
  ])('convertAmount(%f, %f) = %f', (amount, rate, expected) => {
    expect(convertAmount(amount, rate)).toBe(expected);
  });

  it('o resultado sempre tem no máximo 2 casas decimais', () => {
    const result = convertAmount(33.33, 5.123456);

    expect(Math.round(result * 100)).toBeCloseTo(result * 100, 8);
  });
});

describe('EnrichmentService', () => {
  const findById = jest.fn();
  const transition = jest.fn();
  const getRate = jest.fn();
  const getOrThrow = jest.fn().mockReturnValue('BRL');

  const service = new EnrichmentService(
    { findById, transition } as unknown as OrdersService,
    { getRate } satisfies ExchangeRateClient,
    { getOrThrow } as unknown as ConfigService<never, true>,
  );

  beforeEach(() => {
    getOrThrow.mockReturnValue('BRL');
    transition.mockResolvedValue(true);
    getRate.mockResolvedValue({ rate: 5.25, date: '2026-10-20' });
  });

  it('usa a moeda alvo vinda da configuração (TARGET_CURRENCY)', async () => {
    const eurService = new EnrichmentService(
      { findById, transition } as unknown as OrdersService,
      { getRate } satisfies ExchangeRateClient,
      { getOrThrow: () => 'EUR' } as unknown as ConfigService<never, true>,
    );
    findById.mockResolvedValue(buildOrder({ currency: 'USD' }));

    await eurService.enrich('order-1');

    expect(getRate).toHaveBeenCalledWith('USD', 'EUR');
    expect(transition).toHaveBeenLastCalledWith(
      'order-1',
      OrderStatus.ENRICHED,
      expect.objectContaining({ targetCurrency: 'EUR' }),
    );
  });

  it('lança OrderNotFoundError (permanente) quando o pedido não existe', async () => {
    findById.mockResolvedValue(null);

    await expect(service.enrich('sumiu')).rejects.toThrow(OrderNotFoundError);
    expect(transition).not.toHaveBeenCalled();
  });

  it.each([OrderStatus.ENRICHED, OrderStatus.FAILED_ENRICHMENT])(
    'job reentregue para pedido %s é ignorado: sem transição e sem chamada externa',
    async (status) => {
      findById.mockResolvedValue(buildOrder({ status }));

      await expect(service.enrich('order-1')).resolves.toBeUndefined();

      expect(transition).not.toHaveBeenCalled();
      expect(getRate).not.toHaveBeenCalled();
    },
  );

  it('não chama o serviço externo quando a transição para PROCESSING perdeu a corrida', async () => {
    findById.mockResolvedValue(buildOrder());
    transition.mockResolvedValueOnce(false);

    await service.enrich('order-1');

    expect(getRate).not.toHaveBeenCalled();
    expect(transition).toHaveBeenCalledTimes(1);
  });

  describe('caminho feliz', () => {
    beforeEach(() => findById.mockResolvedValue(buildOrder({ total: 119.8 })));

    it('RECEIVED → PROCESSING (incrementando attempts) → ENRICHED, nesta ordem', async () => {
      await service.enrich('order-1');

      expect(transition).toHaveBeenCalledTimes(2);
      const [first, second] = transition.mock.calls as Array<
        [string, OrderStatus, Record<string, unknown>]
      >;
      expect(first[0]).toBe('order-1');
      expect(first[1]).toBe(OrderStatus.PROCESSING);
      expect((first[2].attempts as () => string)()).toBe('attempts + 1');
      expect(second[1]).toBe(OrderStatus.ENRICHED);
    });

    it('consulta a cotação moeda do pedido → moeda alvo', async () => {
      await service.enrich('order-1');

      expect(getRate).toHaveBeenCalledWith('USD', 'BRL');
    });

    it('grava total convertido, taxa, data da taxa e enriched_at', async () => {
      await service.enrich('order-1');

      expect(transition).toHaveBeenLastCalledWith(
        'order-1',
        OrderStatus.ENRICHED,
        {
          targetCurrency: 'BRL',
          convertedTotal: 628.95,
          exchangeRate: 5.25,
          exchangeRateDate: '2026-10-20',
          enrichedAt: expect.any(Date) as Date,
        },
      );
    });

    it('não lança quando a transição final perde a corrida', async () => {
      transition.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      await expect(service.enrich('order-1')).resolves.toBeUndefined();
    });
  });

  describe('moeda do pedido igual à moeda alvo', () => {
    it('usa taxa 1 sem chamar o serviço externo', async () => {
      findById.mockResolvedValue(buildOrder({ currency: 'BRL', total: 80.5 }));

      await service.enrich('order-1');

      expect(getRate).not.toHaveBeenCalled();
      expect(transition).toHaveBeenLastCalledWith(
        'order-1',
        OrderStatus.ENRICHED,
        expect.objectContaining({
          convertedTotal: 80.5,
          exchangeRate: 1,
          exchangeRateDate: new Date().toISOString().slice(0, 10),
        }),
      );
    });
  });

  describe('falha do serviço externo', () => {
    it('propaga o erro (para o BullMQ retentar) e deixa o pedido em PROCESSING', async () => {
      findById.mockResolvedValue(buildOrder());
      const error = new RetryableEnrichmentError('API fora do ar');
      getRate.mockRejectedValue(error);

      await expect(service.enrich('order-1')).rejects.toBe(error);

      expect(transition).toHaveBeenCalledTimes(1);
      expect(transition).toHaveBeenCalledWith(
        'order-1',
        OrderStatus.PROCESSING,
        expect.anything(),
      );
    });
  });
});
