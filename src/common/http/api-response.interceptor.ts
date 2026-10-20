import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { map } from 'rxjs';
import { isPaginatedData } from './api-response.js';
import { SKIP_API_ENVELOPE } from './skip-api-envelope.decorator.js';

/**
 * Wraps every successful controller result in the common API envelope.
 *
 * Single resources become `{ success: true, data }`; payloads created with
 * `paginated()` become `{ success: true, data: { page, pagination } }`. Routes
 * marked with `@SkipApiEnvelope()` (health and the root probe) pass through
 * unchanged. Errors are handled by `ApiExceptionFilter`, never here.
 */
@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_API_ENVELOPE, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skip) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data: unknown) => {
        // A 204/void handler has no body to wrap.
        if (data === undefined) {
          return undefined;
        }

        if (isPaginatedData(data)) {
          return {
            success: true,
            data: {
              page: data.page,
              pagination: data.pagination,
            },
          };
        }

        return { success: true, data };
      }),
    );
  }
}
