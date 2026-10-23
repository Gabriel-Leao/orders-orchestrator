import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../../../src/app.setup';
import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  ListOrdersQueryDto,
  MAX_LIMIT,
} from '../../../src/orders/dto/list-orders.query.dto';
import { OrderStatus } from '../../../src/orders/enums/order-status.enum';

const parse = (query: Record<string, unknown>) =>
  createValidationPipe().transform(query, {
    type: 'query',
    metatype: ListOrdersQueryDto,
  }) as Promise<ListOrdersQueryDto>;

describe('ListOrdersQueryDto', () => {
  it('sem parâmetros: página 1, limite 20 e sem filtro', async () => {
    const query = await parse({});

    expect(query.page).toBe(DEFAULT_PAGE);
    expect(query.limit).toBe(DEFAULT_LIMIT);
    expect(query.status).toBeUndefined();
    expect([DEFAULT_PAGE, DEFAULT_LIMIT, MAX_LIMIT]).toEqual([1, 20, 100]);
  });

  it('converte page e limit de string (query string) para número', async () => {
    const query = await parse({ page: '3', limit: '50' });

    expect(query.page).toBe(3);
    expect(query.limit).toBe(50);
  });

  it.each(Object.values(OrderStatus))('aceita status=%s', async (status) => {
    await expect(parse({ status })).resolves.toMatchObject({ status });
  });

  it('aceita o limite máximo', async () => {
    await expect(parse({ limit: '100' })).resolves.toMatchObject({
      limit: 100,
    });
  });

  it.each([
    ['page=0', { page: '0' }],
    ['page negativa', { page: '-2' }],
    ['page não numérica', { page: 'abc' }],
    ['page decimal', { page: '1.5' }],
    ['limit=0', { limit: '0' }],
    ['limit=101', { limit: '101' }],
    ['limit não numérico', { limit: 'x' }],
    ['status desconhecido', { status: 'DONE' }],
    ['status em minúsculas', { status: 'enriched' }],
    ['parâmetro desconhecido', { sort: 'asc' }],
  ])('rejeita %s com 400', async (_label, query) => {
    await expect(parse(query)).rejects.toThrow(BadRequestException);
  });
});
