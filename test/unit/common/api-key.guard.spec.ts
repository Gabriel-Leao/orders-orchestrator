import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Public } from '../../../src/common/decorators/public.decorator';
import { ApiKeyGuard } from '../../../src/common/guards/api-key.guard';
import type { Env } from '../../../src/config/env.validation';

class SampleController {
  protected(): void {}

  @Public()
  open(): void {}
}

@Public()
class PublicController {
  anything(): void {}
}

describe('ApiKeyGuard', () => {
  const API_KEY = 'segredo-de-teste';
  const config = {
    get: jest.fn().mockReturnValue(API_KEY),
  } as unknown as ConfigService<Env, true>;
  const guard = new ApiKeyGuard(new Reflector(), config);

  const contextFor = (
    handlerOwner: new () => object,
    handlerName: string,
    headers: Record<string, string | undefined>,
  ): ExecutionContext => {
    const proto = handlerOwner.prototype as Record<string, () => void>;
    return {
      getHandler: () => proto[handlerName],
      getClass: () => handlerOwner,
      switchToHttp: () => ({
        getRequest: () => ({
          header: (name: string) => headers[name.toLowerCase()],
        }),
      }),
    } as unknown as ExecutionContext;
  };

  it('libera a requisição quando a x-api-key confere', () => {
    const ctx = contextFor(SampleController, 'protected', {
      'x-api-key': API_KEY,
    });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it.each([
    ['ausente', undefined],
    ['vazia', ''],
    ['errada', 'outra-chave'],
    ['com prefixo correto mas incompleta', API_KEY.slice(0, -1)],
    ['com sufixo extra', `${API_KEY}x`],
    ['com tamanho muito diferente', 'x'.repeat(500)],
  ])('rejeita com 401 quando a chave está %s', (_label, key) => {
    const ctx = contextFor(SampleController, 'protected', {
      'x-api-key': key,
    });

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('é case-sensitive no valor da chave', () => {
    const ctx = contextFor(SampleController, 'protected', {
      'x-api-key': API_KEY.toUpperCase(),
    });

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('libera handlers marcados com @Public() sem exigir chave', () => {
    const ctx = contextFor(SampleController, 'open', {});

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('libera controllers inteiros marcados com @Public()', () => {
    const ctx = contextFor(PublicController, 'anything', {});

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('@Public() em um handler não libera os outros handlers da classe', () => {
    const ctx = contextFor(SampleController, 'protected', {});

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});
