import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { Env } from './config/env.validation';
import { SWAGGER_PATH, setupSwagger } from './config/swagger.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService<Env, true>);

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  const docsHelmet = helmet({ contentSecurityPolicy: false });
  const apiHelmet = helmet();
  app.use((req: Request, res: Response, next: NextFunction) => {
    const isDocs = req.path.startsWith(`/${SWAGGER_PATH}`);
    (isDocs ? docsHelmet : apiHelmet)(req, res, next);
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  setupSwagger(app);

  await app.listen(config.get('PORT', { infer: true }));
}

bootstrap().catch((err) => {
  console.error('Failed to start application', err);
  process.exit(1);
});
