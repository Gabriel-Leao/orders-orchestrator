import { OrderStatus } from '../../../src/orders/enums/order-status.enum';
import {
  ORDER_STATUS_TRANSITIONS,
  allowedSources,
  canTransition,
} from '../../../src/orders/order-status.transitions';

const { RECEIVED, PROCESSING, ENRICHED, FAILED_ENRICHMENT } = OrderStatus;

const EXPECTED_ALLOWED: ReadonlyArray<[OrderStatus, OrderStatus, boolean]> = [
  [RECEIVED, RECEIVED, false],
  [RECEIVED, PROCESSING, true],
  [RECEIVED, ENRICHED, false],
  [RECEIVED, FAILED_ENRICHMENT, false],

  [PROCESSING, RECEIVED, false],
  [PROCESSING, PROCESSING, true],
  [PROCESSING, ENRICHED, true],
  [PROCESSING, FAILED_ENRICHMENT, true],

  [ENRICHED, RECEIVED, false],
  [ENRICHED, PROCESSING, false],
  [ENRICHED, ENRICHED, false],
  [ENRICHED, FAILED_ENRICHMENT, false],

  [FAILED_ENRICHMENT, RECEIVED, false],
  [FAILED_ENRICHMENT, PROCESSING, false],
  [FAILED_ENRICHMENT, ENRICHED, false],
  [FAILED_ENRICHMENT, FAILED_ENRICHMENT, false],
];

describe('máquina de estados do pedido', () => {
  it('a tabela de referência cobre todas as combinações', () => {
    const statuses = Object.values(OrderStatus);

    expect(EXPECTED_ALLOWED).toHaveLength(statuses.length ** 2);
  });

  it.each(EXPECTED_ALLOWED)(
    'canTransition(%s → %s) = %s',
    (from, to, expected) => {
      expect(canTransition(from, to)).toBe(expected);
    },
  );

  it.each([ENRICHED, FAILED_ENRICHMENT])(
    '%s é estado final: não sai para nenhum outro',
    (status) => {
      expect(ORDER_STATUS_TRANSITIONS[status]).toEqual([]);
    },
  );

  describe('allowedSources (origens válidas usadas no UPDATE atômico)', () => {
    it('só RECEIVED e PROCESSING podem ir para PROCESSING', () => {
      expect(allowedSources(PROCESSING).sort()).toEqual([PROCESSING, RECEIVED]);
    });

    it('só PROCESSING pode ir para ENRICHED', () => {
      expect(allowedSources(ENRICHED)).toEqual([PROCESSING]);
    });

    it('só PROCESSING pode ir para FAILED_ENRICHMENT', () => {
      expect(allowedSources(FAILED_ENRICHMENT)).toEqual([PROCESSING]);
    });

    it('nenhum estado pode voltar para RECEIVED', () => {
      expect(allowedSources(RECEIVED)).toEqual([]);
    });
  });
});
