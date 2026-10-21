import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { NextFunction, Request, Response } from 'express';
import { setupSwagger } from './config/swagger.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.use(helmet({ crossOriginResourcePolicy: true }));
  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const docsHelmet = helmet({ contentSecurityPolicy: false });
  const apiHelmet = helmet();
  app.use((req: Request, res: Response, next: NextFunction) =>
    (req.path.startsWith('/docs') ? docsHelmet : apiHelmet)(req, res, next),
  );

  setupSwagger(app);

  await app.listen(process.env.PORT ?? 3333);
}

bootstrap().catch((err) => {
  console.error('Failed to start application', err);
  process.exit(1);
});
