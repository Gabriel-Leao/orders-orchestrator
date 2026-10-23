/**
 * Ambiente dos testes de integração.
 *
 * Os testes NUNCA usam o banco de desenvolvimento: o nome do banco é forçado a
 * terminar em "_test" (ver global-setup.ts) e todas as variáveis da aplicação
 * são definidas aqui, sobrepondo qualquer .env ou variável do shell.
 *
 * Postgres e Redis podem ser apontados com variáveis TEST_*, por exemplo, para
 * os containers do `docker compose up -d postgres redis` em portas alternativas:
 *   TEST_DB_PORT=5433 TEST_REDIS_PORT=6380 npm run test:e2e
 */
const fromEnv = (name: string, fallback: string): string =>
  process.env[name] ?? fallback;

export const TEST_API_KEY = 'test-api-key';
export const TEST_TARGET_CURRENCY = 'BRL';
export const TEST_MAX_ATTEMPTS = 3;
export const TEST_BACKOFF_MS = 100;

export const TEST_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  PORT: '3333',
  API_KEY: TEST_API_KEY,

  DB_HOST: fromEnv('TEST_DB_HOST', 'localhost'),
  DB_PORT: fromEnv('TEST_DB_PORT', '5432'),
  DB_USER: fromEnv('TEST_DB_USER', 'postgres'),
  DB_PASSWORD: fromEnv('TEST_DB_PASSWORD', 'postgres'),
  DB_NAME: fromEnv('TEST_DB_NAME', 'orders_test'),

  REDIS_HOST: fromEnv('TEST_REDIS_HOST', 'localhost'),
  REDIS_PORT: fromEnv('TEST_REDIS_PORT', '6379'),

  // O client real só é usado nos testes que sobem um servidor HTTP fake.
  EXCHANGE_API_URL: 'http://127.0.0.1:9/v1',
  TARGET_CURRENCY: TEST_TARGET_CURRENCY,
  EXTERNAL_TIMEOUT_MS: '1000',

  // Backoff mínimo aceito pelo schema é 100 ms: 3 tentativas = ~300 ms de espera.
  ENRICHMENT_MAX_ATTEMPTS: String(TEST_MAX_ATTEMPTS),
  ENRICHMENT_BACKOFF_MS: String(TEST_BACKOFF_MS),
};
