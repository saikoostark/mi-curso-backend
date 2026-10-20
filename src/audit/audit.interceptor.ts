import { HttpException, Injectable, Logger } from '@nestjs/common';
import type {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { catchError, from, mergeMap, throwError } from 'rxjs';
import type { Observable } from 'rxjs';
import { AuditService } from './audit.service.js';

/** Methods whose requests change state and therefore belong in the audit trail. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Express request with the fields the auth guard / router add. */
interface AuditedRequest extends Request {
  user?: { id?: string };
  route: { path?: string };
  params: Record<string, string>;
}

/**
 * Appends one audit row for every mutating HTTP request.
 *
 * Running globally means new admin/auth routes are covered automatically, and
 * the log records the route *pattern* (`POST /users/:id/restore`) rather than
 * concrete URLs, so filters remain stable across ids. Request bodies, query
 * strings and cookies are never stored — they can contain passwords and
 * single-use tokens.
 *
 * The write is awaited with the response but failures are logged and swallowed:
 * losing an audit row must not turn a successful business action into a 500.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly audit: AuditService) {}

  /**
   * @param context - Execution context of the incoming request.
   * @param next - Downstream handler.
   * @returns The handler result, unchanged.
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuditedRequest>();
    const method = request.method.toUpperCase();

    if (!MUTATING_METHODS.has(method)) {
      return next.handle();
    }

    const action = `${method} ${routePattern(request)}`.slice(0, 200);

    return next.handle().pipe(
      mergeMap(async (data) => {
        await this.recordSafe(request, {
          action,
          success: true,
          statusCode: http.getResponse<Response>().statusCode,
          actorUserId: actorOf(request, data),
        });
        return data;
      }),
      catchError((error: unknown) => {
        const statusCode =
          error instanceof HttpException ? error.getStatus() : 500;
        return from(
          this.recordSafe(request, {
            action,
            success: false,
            statusCode,
            actorUserId: actorOf(request),
          }),
        ).pipe(mergeMap(() => throwError(() => error)));
      }),
    );
  }

  /** Persists one row, logging (but never propagating) storage failures. */
  private async recordSafe(
    request: AuditedRequest,
    outcome: Pick<
      Parameters<AuditService['record']>[0],
      'action' | 'success' | 'statusCode' | 'actorUserId'
    >,
  ): Promise<void> {
    try {
      await this.audit.record({
        ...outcome,
        targetType: targetTypeOf(request),
        targetId: targetIdOf(request),
        ip: request.ip ? request.ip.slice(0, 64) : null,
        userAgent: userAgentOf(request),
      });
    } catch (error) {
      this.logger.error(
        `Audit write failed for ${outcome.action}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

/**
 * Returns the Express route pattern when available, falling back to the
 * concrete path (still without query string or body).
 */
function routePattern(request: AuditedRequest): string {
  const route = request.route?.path;
  return typeof route === 'string' && route.length > 0 ? route : request.path;
}

/** First URL segment, used as the coarse target type. */
function targetTypeOf(request: AuditedRequest): string | null {
  const segment = request.path.split('/').find((part) => part.length > 0);
  return segment ? segment.slice(0, 64) : null;
}

/** Route id/userId/key parameter, when the route carries one. */
function targetIdOf(request: AuditedRequest): string | null {
  const value =
    request.params?.id ?? request.params?.userId ?? request.params?.key ?? null;
  return value ? value.slice(0, 128) : null;
}

/** First user-agent value, bounded to the column length. */
function userAgentOf(request: AuditedRequest): string | null {
  const header = request.headers['user-agent'];
  const value = Array.isArray(header) ? header[0] : header;
  return value ? value.slice(0, 512) : null;
}

/**
 * Resolves the actor id from the guard or, for login/refresh responses, from
 * the user object in the handler result.
 */
function actorOf(request: AuditedRequest, data?: unknown): string | null {
  if (request.user?.id) {
    return request.user.id;
  }

  if (isRecord(data)) {
    const user = isRecord(data.user)
      ? data.user
      : isRecord(data.data) && isRecord(data.data.user)
        ? data.data.user
        : null;
    if (user && typeof user.id === 'string') {
      return user.id;
    }
  }

  return null;
}

/** Narrow an unknown value to a non-null object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
