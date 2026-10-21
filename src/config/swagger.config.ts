import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const SWAGGER_PATH = 'docs';
export const API_KEY_SECURITY = 'api-key';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Orders Orchestrator')
    .setDescription(
      'Recebe pedidos via webhook, processa de forma assíncrona e enriquece os dados com um serviço externo.',
    )
    .setVersion('1.0')
    .addApiKey(
      { type: 'apiKey', name: 'x-api-key', in: 'header' },
      API_KEY_SECURITY,
    )
    .addSecurityRequirements(API_KEY_SECURITY)
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    jsonDocumentUrl: `${SWAGGER_PATH}/json`,
    swaggerOptions: { persistAuthorization: true },
  });
}
