import { validateEnv } from '../../../src/config/env.validation';

const validEnv = (): Record<string, unknown> => ({
  API_KEY: 'change-me',
  DB_HOST: 'localhost',
  DB_USER: 'postgres',
  DB_PASSWORD: 'postgres',
  DB_NAME: 'orders',
  REDIS_HOST: 'localhost',
  EXCHANGE_API_URL: 'https://api.frankfurter.dev/v1',
});

describe('validateEnv', () => {
  it('aplica os defaults documentados quando só o obrigatório é informado', () => {
    const env = validateEnv(validEnv());

    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3333,
      DB_PORT: 5432,
      REDIS_PORT: 6379,
      TARGET_CURRENCY: 'BRL',
      EXTERNAL_TIMEOUT_MS: 5000,
      ENRICHMENT_MAX_ATTEMPTS: 5,
      ENRICHMENT_BACKOFF_MS: 1000,
    });
    expect(env.LOG_LEVEL).toBeUndefined();
  });

  it('converte números vindos como string (process.env só tem strings)', () => {
    const env = validateEnv({
      ...validEnv(),
      PORT: '4000',
      DB_PORT: '5433',
      REDIS_PORT: '6380',
      ENRICHMENT_MAX_ATTEMPTS: '3',
      ENRICHMENT_BACKOFF_MS: '250',
    });

    expect(env).toMatchObject({
      PORT: 4000,
      DB_PORT: 5433,
      REDIS_PORT: 6380,
      ENRICHMENT_MAX_ATTEMPTS: 3,
      ENRICHMENT_BACKOFF_MS: 250,
    });
  });

  it('ignora variáveis desconhecidas (process.env sempre tem outras, ex.: PATH)', () => {
    expect(() =>
      validateEnv({ ...validEnv(), PATH: '/usr/bin', HOME: '/root' }),
    ).not.toThrow();
  });

  it('aceita LOG_LEVEL silent (usado nos testes)', () => {
    expect(validateEnv({ ...validEnv(), LOG_LEVEL: 'silent' }).LOG_LEVEL).toBe(
      'silent',
    );
  });

  it('falha listando todas as variáveis obrigatórias ausentes', () => {
    expect(() => validateEnv({})).toThrow(
      /Invalid environment variables:[\s\S]*API_KEY[\s\S]*DB_HOST[\s\S]*REDIS_HOST[\s\S]*EXCHANGE_API_URL/,
    );
  });

  it.each([
    ['API_KEY vazia', { API_KEY: '' }],
    ['API_KEY só com espaços', { API_KEY: '   ' }],
    ['DB_PASSWORD vazia', { DB_PASSWORD: '' }],
    ['PORT fora do intervalo', { PORT: '70000' }],
    ['PORT não numérica', { PORT: 'abc' }],
    ['NODE_ENV desconhecido', { NODE_ENV: 'staging' }],
    ['LOG_LEVEL desconhecido', { LOG_LEVEL: 'verbose' }],
    ['EXCHANGE_API_URL inválida', { EXCHANGE_API_URL: 'api.frankfurter.dev' }],
    [
      'EXCHANGE_API_URL com protocolo não HTTP',
      { EXCHANGE_API_URL: 'ftp://host/v1' },
    ],
    ['TARGET_CURRENCY em minúsculas', { TARGET_CURRENCY: 'brl' }],
    ['TARGET_CURRENCY com 2 letras', { TARGET_CURRENCY: 'BR' }],
    ['EXTERNAL_TIMEOUT_MS zero', { EXTERNAL_TIMEOUT_MS: '0' }],
    ['ENRICHMENT_MAX_ATTEMPTS zero', { ENRICHMENT_MAX_ATTEMPTS: '0' }],
    ['ENRICHMENT_MAX_ATTEMPTS fracionário', { ENRICHMENT_MAX_ATTEMPTS: '2.5' }],
    ['ENRICHMENT_BACKOFF_MS abaixo de 100', { ENRICHMENT_BACKOFF_MS: '99' }],
  ])('rejeita %s', (_label, override) => {
    expect(() => validateEnv({ ...validEnv(), ...override })).toThrow(
      /Invalid environment variables/,
    );
  });

  it('aceita o limite inferior do backoff (100 ms)', () => {
    expect(
      validateEnv({ ...validEnv(), ENRICHMENT_BACKOFF_MS: '100' })
        .ENRICHMENT_BACKOFF_MS,
    ).toBe(100);
  });
});
