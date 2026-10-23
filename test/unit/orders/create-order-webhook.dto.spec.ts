import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../../../src/app.setup';
import { CreateOrderWebhookDto } from '../../../src/orders/dto/create-order-webhook.dto';
import { buildWebhookPayload } from '../../support/builders';

const validate = (payload: unknown) =>
  createValidationPipe().transform(payload, {
    type: 'body',
    metatype: CreateOrderWebhookDto,
  }) as Promise<CreateOrderWebhookDto>;

const messagesOf = async (payload: unknown): Promise<string[]> => {
  try {
    await validate(payload);
  } catch (error) {
    const response = (error as BadRequestException).getResponse() as {
      message: string[];
    };
    return response.message;
  }
  throw new Error('a validação deveria ter falhado');
};

describe('CreateOrderWebhookDto (validação do webhook)', () => {
  it('aceita o payload do enunciado e o transforma em instâncias das classes do DTO', async () => {
    const payload = buildWebhookPayload();

    const dto = await validate(payload);

    expect(dto).toBeInstanceOf(CreateOrderWebhookDto);
    expect(dto.customer.email).toBe('user@example.com');
    expect(dto.items[0].unit_price).toBe(59.9);
  });

  it('aceita preço com 2 casas, limites de tamanho e múltiplos itens', async () => {
    const payload = buildWebhookPayload({
      order_id: 'x'.repeat(100),
      idempotency_key: 'k'.repeat(128),
      items: [
        { sku: 'S'.repeat(64), qty: 1, unit_price: 0.01 },
        { sku: 'B', qty: 999, unit_price: 12345.67 },
      ],
    });

    await expect(validate(payload)).resolves.toBeDefined();
  });

  it('aceita idempotency_key de 8 caracteres (mínimo) e hash de 64', async () => {
    await expect(
      validate(buildWebhookPayload({ idempotency_key: '12345678' })),
    ).resolves.toBeDefined();
    await expect(
      validate(buildWebhookPayload({ idempotency_key: 'a'.repeat(64) })),
    ).resolves.toBeDefined();
  });

  describe('rejeita e aponta o campo', () => {
    const base = () => buildWebhookPayload();
    const item = { sku: 'A', qty: 1, unit_price: 10 };

    it.each([
      ['order_id ausente', { ...base(), order_id: undefined }, /order_id/],
      ['order_id vazio', { ...base(), order_id: '' }, /order_id/],
      [
        'order_id com 101 caracteres',
        { ...base(), order_id: 'x'.repeat(101) },
        /order_id/,
      ],
      ['order_id numérico', { ...base(), order_id: 123 }, /order_id/],
      ['customer ausente', { ...base(), customer: undefined }, /customer/],
      [
        'e-mail inválido',
        { ...base(), customer: { email: 'x', name: 'Ana' } },
        /customer\.email/,
      ],
      [
        'nome do cliente vazio',
        { ...base(), customer: { email: 'a@b.co', name: '' } },
        /customer\.name/,
      ],
      ['items ausente', { ...base(), items: undefined }, /items/],
      ['items vazio', { ...base(), items: [] }, /items/],
      [
        'items com 101 elementos',
        { ...base(), items: Array(101).fill(item) },
        /items/,
      ],
      [
        'sku vazio',
        { ...base(), items: [{ ...item, sku: '' }] },
        /items\.0\.sku/,
      ],
      [
        'sku com 65 caracteres',
        { ...base(), items: [{ ...item, sku: 'S'.repeat(65) }] },
        /items\.0\.sku/,
      ],
      [
        'qty zero',
        { ...base(), items: [{ ...item, qty: 0 }] },
        /items\.0\.qty/,
      ],
      [
        'qty negativa',
        { ...base(), items: [{ ...item, qty: -1 }] },
        /items\.0\.qty/,
      ],
      [
        'qty fracionária',
        { ...base(), items: [{ ...item, qty: 1.5 }] },
        /items\.0\.qty/,
      ],
      [
        'unit_price zero',
        { ...base(), items: [{ ...item, unit_price: 0 }] },
        /items\.0\.unit_price/,
      ],
      [
        'unit_price negativo',
        { ...base(), items: [{ ...item, unit_price: -1 }] },
        /items\.0\.unit_price/,
      ],
      [
        'unit_price com 3 casas',
        { ...base(), items: [{ ...item, unit_price: 1.005 }] },
        /items\.0\.unit_price/,
      ],
      [
        'unit_price string',
        { ...base(), items: [{ ...item, unit_price: '10' }] },
        /items\.0\.unit_price/,
      ],
      ['moeda minúscula', { ...base(), currency: 'usd' }, /currency/],
      ['moeda com 4 letras', { ...base(), currency: 'USDT' }, /currency/],
      ['moeda ausente', { ...base(), currency: undefined }, /currency/],
      [
        'idempotency_key com 7 caracteres',
        { ...base(), idempotency_key: '1234567' },
        /idempotency_key/,
      ],
      [
        'idempotency_key com 129 caracteres',
        { ...base(), idempotency_key: 'k'.repeat(129) },
        /idempotency_key/,
      ],
      [
        'idempotency_key ausente',
        { ...base(), idempotency_key: undefined },
        /idempotency_key/,
      ],
    ])('%s', async (_label, payload, field) => {
      const messages = await messagesOf(payload);

      expect(messages.join('\n')).toMatch(field);
    });
  });

  describe('campos desconhecidos (forbidNonWhitelisted)', () => {
    it('rejeita campo extra na raiz', async () => {
      const messages = await messagesOf({ ...buildWebhookPayload(), extra: 1 });

      expect(messages).toContain('property extra should not exist');
    });

    it('rejeita campo extra em item', async () => {
      const payload = buildWebhookPayload({
        items: [{ sku: 'A', qty: 1, unit_price: 1, desconto: 5 } as never],
      });

      const messages = await messagesOf(payload);

      expect(messages.join('\n')).toMatch(/desconto should not exist/);
    });
  });
});
