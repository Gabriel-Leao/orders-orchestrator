import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { DataSource } from 'typeorm';
import { ORDERS_QUEUE, QUEUE_PREFIX } from '../../src/queue/queue.constants';
import { TEST_ENV } from './test-env';

const ROOT = path.resolve(__dirname, '..', '..');

async function ensureDatabase(): Promise<void> {
  const name = TEST_ENV.DB_NAME;

  if (!name.endsWith('_test')) {
    throw new Error(
      `Recusando rodar os testes de integração no banco "${name}": ` +
        'eles limpam a tabela orders, então o nome precisa terminar em "_test" ' +
        '(ajuste TEST_DB_NAME).',
    );
  }

  const admin = new DataSource({
    type: 'postgres',
    host: TEST_ENV.DB_HOST,
    port: Number(TEST_ENV.DB_PORT),
    username: TEST_ENV.DB_USER,
    password: TEST_ENV.DB_PASSWORD,
    database: 'postgres',
  });

  try {
    await admin.initialize();
  } catch (error) {
    throw new Error(
      `Postgres inacessível em ${TEST_ENV.DB_HOST}:${TEST_ENV.DB_PORT} ` +
        `(${(error as Error).message}). Suba o banco ou ajuste TEST_DB_*.`,
    );
  }

  try {
    const found: unknown[] = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [name],
    );
    if (found.length === 0) await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.destroy();
  }
}

function runMigrations(): void {
  // Usa o mesmo caminho do dia a dia (npm run migration:run), o que também
  // valida o data-source e a migration contra um banco vazio.
  try {
    execFileSync('npm', ['run', '--silent', 'migration:run'], {
      cwd: ROOT,
      env: { ...process.env, ...TEST_ENV },
      stdio: 'pipe',
    });
  } catch (error) {
    const failure = error as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(
      'Falha ao rodar as migrations no banco de teste:\n' +
        `${failure.stdout?.toString() ?? ''}${failure.stderr?.toString() ?? ''}`,
    );
  }
}

/**
 * O Redis costuma ser compartilhado e o prefixo das filas é fixo. Se outra
 * instância da API (ex.: `npm run start:dev`) estiver com worker na fila
 * "orders", ela consumiria os jobs dos testes (e os testes apagariam os dela).
 */
async function assertNoForeignWorkers(): Promise<void> {
  const connection = new IORedis({
    host: TEST_ENV.REDIS_HOST,
    port: Number(TEST_ENV.REDIS_PORT),
    maxRetriesPerRequest: null,
    lazyConnect: true,
    retryStrategy: () => null,
  });

  try {
    await connection.connect();
  } catch (error) {
    connection.disconnect();
    throw new Error(
      `Redis inacessível em ${TEST_ENV.REDIS_HOST}:${TEST_ENV.REDIS_PORT} ` +
        `(${(error as Error).message}). Suba o Redis ou ajuste TEST_REDIS_*.`,
    );
  }

  const queue = new Queue(ORDERS_QUEUE, { connection, prefix: QUEUE_PREFIX });
  try {
    const workers = await queue.getWorkers();
    if (workers.length > 0) {
      throw new Error(
        `Já existe worker na fila "${QUEUE_PREFIX}:${ORDERS_QUEUE}" ` +
          `(${workers.length} conexão(ões)). Pare a API local (npm run start:dev) ` +
          'ou use outro Redis (TEST_REDIS_PORT) antes de rodar os testes.',
      );
    }
  } finally {
    await queue.close();
    await connection.quit();
  }
}

export default async function globalSetup(): Promise<void> {
  await ensureDatabase();
  runMigrations();
  await assertNoForeignWorkers();
}
