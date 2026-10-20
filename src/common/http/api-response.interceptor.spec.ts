import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import { paginated } from './api-response.js';
import { ApiResponseInterceptor } from './api-response.interceptor.js';
import { buildPaginationMeta } from './pagination.js';

/**
 * Builds a minimal execution context for the interceptor.
 *
 * @returns A context whose handler/class metadata lookups are harmless.
 */
function makeContext(): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

/**
 * Builds a call handler that emits one value.
 *
 * @param value - Controller return value.
 * @returns The call handler.
 */
function nextWith(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

/**
 * Builds the interceptor with a reflector stub.
 *
 * @param skip - Value returned by the metadata lookup.
 * @returns The interceptor.
 */
function makeInterceptor(skip = false): ApiResponseInterceptor {
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(skip),
  } as unknown as Reflector;

  return new ApiResponseInterceptor(reflector);
}

describe('ApiResponseInterceptor', () => {
  it('wraps single resources in the success envelope', async () => {
    const result = await firstValueFrom(
      makeInterceptor().intercept(makeContext(), nextWith({ id: 'user-1' })),
    );

    expect(result).toEqual({ success: true, data: { id: 'user-1' } });
  });

  it('unwraps paged payloads into data.page plus data.pagination', async () => {
    const pagination = buildPaginationMeta(2, 25, 42);
    const result = await firstValueFrom(
      makeInterceptor().intercept(
        makeContext(),
        nextWith(paginated([{ id: 'user-1' }], pagination)),
      ),
    );

    expect(result).toEqual({
      success: true,
      data: {
        page: [{ id: 'user-1' }],
        pagination,
      },
    });
  });

  it('leaves responses marked with @SkipApiEnvelope untouched', async () => {
    const result = await firstValueFrom(
      makeInterceptor(true).intercept(
        makeContext(),
        nextWith({ status: 'ok' }),
      ),
    );

    expect(result).toEqual({ status: 'ok' });
  });

  it('does not add a body to void responses', async () => {
    const result = await firstValueFrom(
      makeInterceptor().intercept(makeContext(), nextWith(undefined)),
    );

    expect(result).toBeUndefined();
  });
});
