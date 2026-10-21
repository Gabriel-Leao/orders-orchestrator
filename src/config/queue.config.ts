import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QUEUE_PREFIX } from '../queue/queue.constants';
import { Env } from './env.validation';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: {
          host: config.getOrThrow<string>('REDIS_HOST'),
          port: config.getOrThrow<number>('REDIS_PORT'),
        },
        prefix: QUEUE_PREFIX,
        defaultJobOptions: {
          attempts: config.getOrThrow<number>('ENRICHMENT_MAX_ATTEMPTS'),
          backoff: {
            type: 'exponential',
            delay: config.getOrThrow<number>('ENRICHMENT_BACKOFF_MS'),
          },
          removeOnComplete: { age: 3600, count: 1000 },
          removeOnFail: false,
        },
      }),
    }),
  ],
})
export class AppQueueModule {}
