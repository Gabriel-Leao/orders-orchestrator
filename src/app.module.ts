import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { AppLoggerModule } from './config/logger.config';
import { AppDatabaseModule } from './config/database.config';
import { AppQueueModule } from './config/queue.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    AppLoggerModule,
    AppDatabaseModule,
    AppQueueModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
