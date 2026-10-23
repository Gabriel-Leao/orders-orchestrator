import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import type { Server } from 'node:http';
import { DataSource, Repository, SimpleConsoleLogger } from 'typeorm';
import { configureApp } from '../../src/app.setup';
import { EXCHANGE_RATE_CLIENT } from '../../src/enrichment/clients/exchange-rate.client';
import { Order } from '../../src/orders/entities/order.entity';
import { OrdersService } from '../../src/orders/orders.service';
import {
  ORDERS_DLQ,
  ORDERS_QUEUE,
  QUEUE_PREFIX,
} from '../../src/queue/queue.constants';
import { FakeExchangeRateClient } from './fake-exchange-rate.client';
import { TEST_ENV } from './test-env';

export interface TestContext {
  app: INestApplication;
  server: Server;
  exchange: FakeExchangeRateClient;
  dataSource: DataSource;
  orders: Repository<Order>;
  ordersService: OrdersService;
  ordersQueue: Queue;
  dlq: Queue;
  /** Esvazia a tabela orders e as chaves do Redis com o prefixo da aplicação. */
  reset: () => Promise<void>;
  close: () => Promise<void>;
}

export interface CreateTestAppOptions {
  /** Usa o client real da Frankfurter (apontado por env) em vez do fake. */
  realExchangeClient?: boolean;
  /** Variáveis de ambiente extras, restauradas no close(). */
  env?: Record<string, string>;
}

/** Apaga só as chaves do prefixo da aplicação (o Redis pode ser compartilhado). */
export async function clearQueueKeys(redis: IORedis): Promise<void> {
  const pattern = `${QUEUE_PREFIX}:*`;
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(
      cursor,
      'MATCH',
      pattern,
      'COUNT',
      200,
    );
    cursor = next;
    if (keys.length > 0) await redis.del(...keys);
  } while (cursor !== '0');
}

export async function createTestApp(
  options: CreateTestAppOptions = {},
): Promise<TestContext> {
  const previousEnv: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(options.env ?? {})) {
    previousEnv[key] = process.env[key];
    process.env[key] = value;
  }

  // Import dinâmico: o ConfigModule valida o ambiente quando o AppModule é
  // carregado, então ele só pode ser importado depois de aplicar `options.env`.
  // (require, e não import(): com module "nodenext" o import() dinâmico ficaria
  // nativo e o Jest exigiria --experimental-vm-modules.)
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { AppModule } =
    require('../../src/app.module') as typeof import('../../src/app.module');
  /* eslint-enable @typescript-eslint/no-require-imports */

  const exchange = new FakeExchangeRateClient();
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (!options.realExchangeClient) {
    builder = builder.overrideProvider(EXCHANGE_RATE_CLIENT).useValue(exchange);
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app);
  // Escuta numa porta efêmera: o supertest reaproveita o servidor já ouvindo.
  await app.listen(0);

  const redis = new IORedis({
    host: TEST_ENV.REDIS_HOST,
    port: Number(TEST_ENV.REDIS_PORT),
    maxRetriesPerRequest: null,
  });
  const dataSource = app.get(DataSource);
  // Violações de UNIQUE são esperadas nos testes de idempotência; sem ruído.
  dataSource.logger = new SimpleConsoleLogger(false);

  const reset = async (): Promise<void> => {
    await dataSource.query('TRUNCATE TABLE orders');
    await clearQueueKeys(redis);
    exchange.reset();
  };

  const close = async (): Promise<void> => {
    await app.close();
    await redis.quit();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };

  return {
    app,
    server: app.getHttpServer() as Server,
    exchange,
    dataSource,
    orders: dataSource.getRepository(Order),
    ordersService: app.get(OrdersService),
    ordersQueue: app.get<Queue>(getQueueToken(ORDERS_QUEUE)),
    dlq: app.get<Queue>(getQueueToken(ORDERS_DLQ)),
    reset,
    close,
  };
}
