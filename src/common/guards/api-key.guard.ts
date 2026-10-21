import { createHash, timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Env } from '../../config/env.validation';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

const digest = (value: string): Buffer =>
  createHash('sha256').update(value).digest();

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly expected: Buffer;

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService<Env, true>,
  ) {
    this.expected = digest(config.get('API_KEY', { infer: true }));
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const provided = context
      .switchToHttp()
      .getRequest<Request>()
      .header('x-api-key');

    if (!provided || !timingSafeEqual(digest(provided), this.expected)) {
      throw new UnauthorizedException('Invalid or missing API key');
    }
    return true;
  }
}
