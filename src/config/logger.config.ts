import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isDev = config.get('NODE_ENV') === 'development';
        return {
          pinoHttp: {
            level: isDev ? 'debug' : 'info',
            transport: isDev
              ? {
                  target: 'pino-pretty',
                  options: { colorize: true, singleLine: true },
                }
              : undefined,
            redact: ['req.headers.authorization', 'req.headers.cookie'],
            serializers: {
              req: (req: Request) => ({
                method: req.method,
                url: req.url,
                requestId: req.id,
              }),
              res: (res: Response) => ({
                statusCode: res.statusCode,
              }),
            },
          },
        };
      },
    }),
  ],
})
export class AppLoggerModule {}
