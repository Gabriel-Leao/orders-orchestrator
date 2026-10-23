import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { Env } from './config/env.validation';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService<Env, true>);

  configureApp(app);
  app.enableShutdownHooks();

  await app.listen(config.get('PORT', { infer: true }));
}

bootstrap().catch((err) => {
  console.error('Failed to start application', err);
  process.exit(1);
});
