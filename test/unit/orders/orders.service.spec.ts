import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { QueryFailedError, type Repository } from 'typeorm';
import { CreateOrderWebhookDto } from '../../../src/orders/dto/create-order-webhook.dto';
import {
  ORDER_EXTERNAL_ID_CONSTRAINT,
  ORDER_IDEMPOTENCY_CONSTRAINT,
  Order,
} from '../../../src/orders/entities/order.entity';
import { OrderStatus } from '../../../src/orders/enums/order-status.enum';
import type { OrdersProducer } from '../../../src/orders/orders.producer';
import { OrdersService } from '../../../src/orders/orders.service';
import {
  type WebhookPayload,
  buildWebhookPayload,
} from '../../support/builders';
import { buildOrder } from '../../support/order-factory';

const uniqueViolation = (constraint: string, code = '23505') =>
  new QueryFailedError(
    'INSERT INTO orders ...',
    [],
    Object.assign(new Error(`duplicate key value violates "${constraint}"`), {
      code,
      constraint,
    }),
  );

describe('OrdersService', () => {
  const findOne = jest.fn();
  const create = jest.fn();
  const save = jest.fn();
  const findAndCount = jest.fn();
  const execute = jest.fn();
  const where = jest.fn();
  const andWhere = jest.fn();
  const set = jest.fn();
  const update = jest.fn();
  const createQueryBuilder = jest.fn();
  const enqueueEnrichment = jest.fn();

  let service: OrdersService;

  const dto = (
    overrides: Partial<WebhookPayload> = {},
  ): CreateOrderWebhookDto =>
    buildWebhookPayload({ idempotency_key: 'key-12345678', ...overrides });

  beforeEach(() => {
    create.mockImplementation((data: Partial<Order>) => buildOrder(data));
    save.mockImplementation((order: Order) => Promise.resolve(order));
    enqueueEnrichment.mockResolvedValue(undefined);

    update.mockReturnValue({ set });
    set.mockReturnValue({ where });
    where.mockReturnValue({ andWhere });
    andWhere.mockReturnValue({ execute });
    createQueryBuilder.mockReturnValue({ update });

    service = new OrdersService(
      {
        findOne,
        create,
        save,
        findAndCount,
        createQueryBuilder,
      } as unknown as Repository<Order>,
      { enqueueEnrichment } as unknown as OrdersProducer,
    );
  });

  describe('receive - pedido novo', () => {
    beforeEach(() => findOne.mockResolvedValue(null));

    it('persiste como RECEIVED mapeando o payload para a entity e enfileira', async () => {
      const input = dto({ order_id: 'ext-9', currency: 'EUR' });

      const { order, created } = await service.receive(input);

      expect(created).toBe(true);
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          externalOrderId: 'ext-9',
          idempotencyKey: 'key-12345678',
          customerEmail: 'user@example.com',
          customerName: 'Ana',
          items: [{ sku: 'ABC123', qty: 2, unitPrice: 59.9 }],
          currency: 'EUR',
          total: 119.8,
          status: OrderStatus.RECEIVED,
        }),
      );
      expect(save).toHaveBeenCalledTimes(1);
      expect(enqueueEnrichment).toHaveBeenCalledWith(order.id);
    });

    it('calcula o total em centavos inteiros, sem ruído de ponto flutuante', async () => {
      const input = dto({
        items: [
          { sku: 'A', qty: 3, unit_price: 0.1 },
          { sku: 'B', qty: 3, unit_price: 19.99 },
        ],
      });

      await service.receive(input);

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ total: 60.27 }),
      );
    });

    it('consulta primeiro pela idempotency_key', async () => {
      await service.receive(dto());

      expect(findOne).toHaveBeenCalledWith({
        where: { idempotencyKey: 'key-12345678' },
      });
    });
  });

  describe('receive - replay (idempotency_key já existente)', () => {
    it('não grava de novo e devolve created=false', async () => {
      const existing = buildOrder({ status: OrderStatus.ENRICHED });
      findOne.mockResolvedValue(existing);

      const result = await service.receive(dto());

      expect(result).toEqual({ order: existing, created: false });
      expect(create).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
    });

    it('reenfileira quando o pedido ficou RECEIVED (janela "gravou mas não enfileirou")', async () => {
      const orphan = buildOrder({ status: OrderStatus.RECEIVED });
      findOne.mockResolvedValue(orphan);

      const result = await service.receive(dto());

      expect(result.created).toBe(false);
      expect(enqueueEnrichment).toHaveBeenCalledWith(orphan.id);
    });

    it.each([
      OrderStatus.PROCESSING,
      OrderStatus.ENRICHED,
      OrderStatus.FAILED_ENRICHMENT,
    ])('não reenfileira pedido em %s', async (status) => {
      findOne.mockResolvedValue(buildOrder({ status }));

      await service.receive(dto());

      expect(enqueueEnrichment).not.toHaveBeenCalled();
    });
  });

  describe('receive - corrida entre requisições (violação de UNIQUE)', () => {
    it('perdeu a corrida pela idempotency_key: devolve o pedido vencedor como replay', async () => {
      const winner = buildOrder({ status: OrderStatus.PROCESSING });
      findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
      save.mockRejectedValue(uniqueViolation(ORDER_IDEMPOTENCY_CONSTRAINT));

      const result = await service.receive(dto());

      expect(result).toEqual({ order: winner, created: false });
    });

    it('Postgres cita a constraint de order_id numa requisição idêntica: ainda é replay, não 409', async () => {
      const winner = buildOrder({ status: OrderStatus.RECEIVED });
      findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
      save.mockRejectedValue(uniqueViolation(ORDER_EXTERNAL_ID_CONSTRAINT));

      const result = await service.receive(dto());

      expect(result).toEqual({ order: winner, created: false });
      expect(enqueueEnrichment).toHaveBeenCalledWith(winner.id);
    });

    it('order_id já usado com outra idempotency_key: 409 citando o order_id', async () => {
      findOne.mockResolvedValue(null);
      save.mockRejectedValue(uniqueViolation(ORDER_EXTERNAL_ID_CONSTRAINT));

      const attempt = service.receive(dto({ order_id: 'ext-dup' }));

      await expect(attempt).rejects.toThrow(ConflictException);
      await expect(attempt).rejects.toThrow(/ext-dup/);
      expect(enqueueEnrichment).not.toHaveBeenCalled();
    });

    it('idempotency_key violada mas vencedor sumiu: propaga o erro original', async () => {
      const error = uniqueViolation(ORDER_IDEMPOTENCY_CONSTRAINT);
      findOne.mockResolvedValue(null);
      save.mockRejectedValue(error);

      await expect(service.receive(dto())).rejects.toBe(error);
    });

    it.each([
      ['constraint desconhecida', uniqueViolation('UQ_outra_coisa')],
      [
        'outro código de erro do Postgres',
        uniqueViolation(ORDER_IDEMPOTENCY_CONSTRAINT, '23502'),
      ],
      ['erro que não é do banco', new Error('boom')],
    ])('propaga o erro original em caso de %s', async (_label, error) => {
      findOne.mockResolvedValue(null);
      save.mockRejectedValue(error);

      await expect(service.receive(dto())).rejects.toBe(error);
      expect(enqueueEnrichment).not.toHaveBeenCalled();
    });
  });

  describe('receive - falha ao enfileirar', () => {
    it('responde 503 orientando a reenviar a mesma idempotency_key', async () => {
      findOne.mockResolvedValue(null);
      enqueueEnrichment.mockRejectedValue(
        new Error('Redis did not respond within 3000ms'),
      );

      const attempt = service.receive(dto());

      await expect(attempt).rejects.toThrow(ServiceUnavailableException);
      await expect(attempt).rejects.toThrow(/idempotency_key/);
      expect(save).toHaveBeenCalledTimes(1);
    });
  });

  describe('transition', () => {
    it('faz UPDATE condicional: só atualiza se o status atual for uma origem válida', async () => {
      execute.mockResolvedValue({ affected: 1 });

      const applied = await service.transition(
        'order-1',
        OrderStatus.ENRICHED,
        {
          failureReason: null,
        },
      );

      expect(applied).toBe(true);
      expect(set).toHaveBeenCalledWith({
        failureReason: null,
        status: OrderStatus.ENRICHED,
      });
      expect(where).toHaveBeenCalledWith('id = :id', { id: 'order-1' });
      expect(andWhere).toHaveBeenCalledWith('status IN (:...from)', {
        from: [OrderStatus.PROCESSING],
      });
    });

    it('o status de destino prevalece sobre um status passado em changes', async () => {
      execute.mockResolvedValue({ affected: 1 });

      await service.transition('order-1', OrderStatus.PROCESSING, {
        status: OrderStatus.ENRICHED,
      });

      expect(set).toHaveBeenCalledWith({ status: OrderStatus.PROCESSING });
    });

    it.each([[0], [undefined]])(
      'devolve false quando nenhuma linha foi afetada (affected=%s)',
      async (affected) => {
        execute.mockResolvedValue({ affected });

        await expect(
          service.transition('order-1', OrderStatus.ENRICHED),
        ).resolves.toBe(false);
      },
    );
  });

  describe('list', () => {
    beforeEach(() => findAndCount.mockResolvedValue([[buildOrder()], 41]));

    it('ordena por created_at e id decrescentes e calcula skip/take', async () => {
      const result = await service.list({ page: 3, limit: 10 });

      expect(findAndCount).toHaveBeenCalledWith({
        where: {},
        order: { createdAt: 'DESC', id: 'DESC' },
        skip: 20,
        take: 10,
      });
      expect(result).toEqual({
        items: [expect.any(Order)],
        total: 41,
        page: 3,
        limit: 10,
      });
    });

    it('aplica o filtro de status quando informado', async () => {
      await service.list({
        status: OrderStatus.FAILED_ENRICHMENT,
        page: 1,
        limit: 20,
      });

      expect(findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: OrderStatus.FAILED_ENRICHMENT },
          skip: 0,
        }),
      );
    });
  });

  describe('getById', () => {
    it('devolve o pedido quando existe', async () => {
      const order = buildOrder();
      findOne.mockResolvedValue(order);

      await expect(service.getById(order.id)).resolves.toBe(order);
    });

    it('lança NotFoundException quando não existe', async () => {
      findOne.mockResolvedValue(null);

      await expect(service.getById('inexistente')).rejects.toThrow(
        'Order inexistente not found',
      );
    });
  });
});
