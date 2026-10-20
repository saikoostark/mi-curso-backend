import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ExecutionContext } from '@nestjs/common';
import { MetricsTokenGuard } from './metrics-token.guard.js';

/** ConfigService double backed by a plain map. */
function createConfig(token?: string): ConfigService {
  return {
    get: (key: string) => (key === 'METRICS_TOKEN' ? token : undefined),
  } as unknown as ConfigService;
}

/** Execution context carrying just the Authorization header. */
function createContext(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: authorization === undefined ? {} : { authorization },
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('MetricsTokenGuard', () => {
  it('leaves metrics open when no token is configured', () => {
    const guard = new MetricsTokenGuard(createConfig(undefined));

    expect(guard.canActivate(createContext())).toBe(true);
  });

  it('accepts the configured bearer token', () => {
    const guard = new MetricsTokenGuard(createConfig('metrics-secret'));

    expect(guard.canActivate(createContext('Bearer metrics-secret'))).toBe(
      true,
    );
  });

  it('rejects a missing or wrong token when one is configured', () => {
    const guard = new MetricsTokenGuard(createConfig('metrics-secret'));

    for (const header of [undefined, 'Bearer wrong', 'metrics-secret']) {
      try {
        guard.canActivate(createContext(header));
        throw new Error('expected the guard to reject');
      } catch (error) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        expect((error as UnauthorizedException).getResponse()).toMatchObject({
          code: 'unauthorized',
        });
      }
    }
  });
});
