import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { SWAGGER_PATH, setupSwagger } from './config/swagger.config';

export const createValidationPipe = (): ValidationPipe =>
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

export function configureApp(app: INestApplication): void {
  app.useLogger(app.get(Logger));

  const docsHelmet = helmet({ contentSecurityPolicy: false });
  const apiHelmet = helmet();
  app.use((req: Request, res: Response, next: NextFunction) => {
    const isDocs = req.path.startsWith(`/${SWAGGER_PATH}`);
    (isDocs ? docsHelmet : apiHelmet)(req, res, next);
  });

  app.useGlobalPipes(createValidationPipe());

  setupSwagger(app);
}
