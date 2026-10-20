import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiErrorDetail, ApiErrorPayload } from './api-error.js';
import { COMMON_ERROR_CODES } from './error-codes.js';

const CODE_BY_STATUS: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: COMMON_ERROR_CODES.badRequest,
  [HttpStatus.UNAUTHORIZED]: COMMON_ERROR_CODES.unauthorized,
  [HttpStatus.FORBIDDEN]: COMMON_ERROR_CODES.forbidden,
  [HttpStatus.NOT_FOUND]: COMMON_ERROR_CODES.notFound,
  [HttpStatus.CONFLICT]: COMMON_ERROR_CODES.conflict,
  [HttpStatus.UNPROCESSABLE_ENTITY]: COMMON_ERROR_CODES.unprocessableEntity,
  [HttpStatus.TOO_MANY_REQUESTS]: COMMON_ERROR_CODES.rateLimited,
  [HttpStatus.INTERNAL_SERVER_ERROR]: COMMON_ERROR_CODES.internalError,
};

const MESSAGE_BY_STATUS: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'Bad request.',
  [HttpStatus.UNAUTHORIZED]: 'Authentication required.',
  [HttpStatus.FORBIDDEN]: 'Access denied.',
  [HttpStatus.NOT_FOUND]: 'Not found.',
  [HttpStatus.CONFLICT]: 'Conflict.',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unprocessable entity.',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Too many requests.',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal server error.',
};

/**
 * Converts every thrown value into the common error envelope.
 *
 * Domain exceptions already carry `{ code, message }`; validation errors carry
 * `details`; extra context (such as the missing attribute keys) is preserved
 * under `meta`. Unexpected exceptions are logged and returned as a generic 500
 * so internal details never leak.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (response.headersSent) {
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const error = toErrorPayload(status, exception.getResponse());

      response.status(status).json({ success: false, error });
      return;
    }

    this.logger.error(
      exception instanceof Error ? exception.message : 'Unhandled exception',
      exception instanceof Error ? exception.stack : undefined,
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: COMMON_ERROR_CODES.internalError,
        message: 'Internal server error.',
      },
    });
  }
}

/**
 * Normalizes the many `HttpException` response shapes into one payload.
 *
 * @param status - HTTP status code.
 * @param body - `HttpException.getResponse()` result.
 * @returns The normalized error payload.
 */
function toErrorPayload(
  status: number,
  body: string | object,
): ApiErrorPayload {
  if (typeof body === 'string') {
    return { code: codeForStatus(status), message: body };
  }

  const record = body as Record<string, unknown>;
  const code = typeof record.code === 'string' ? record.code : undefined;
  const message =
    typeof record.message === 'string' ? record.message : undefined;
  const details = normalizeDetails(record.details);
  const meta = extraFields(record);

  // Default Nest validation shape (`message: string[]`) in case an exception
  // bypassed the project's validation exception factory.
  if (Array.isArray(record.message)) {
    return {
      code: code ?? COMMON_ERROR_CODES.validationFailed,
      message: message ?? 'Validation failed.',
      details: record.message.map((value) => ({ message: String(value) })),
      ...(meta ? { meta } : {}),
    };
  }

  return {
    code: code ?? codeForStatus(status),
    message: message ?? messageForStatus(status),
    ...(details ? { details } : {}),
    ...(meta ? { meta } : {}),
  };
}

/**
 * Keeps only structured `{ field?, message }` details.
 *
 * @param value - Candidate `details` value.
 * @returns Normalized details, or `undefined` when there are none.
 */
function normalizeDetails(value: unknown): ApiErrorDetail[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  return value.map((detail) => {
    if (typeof detail === 'string') {
      return { message: detail };
    }

    if (typeof detail === 'object' && detail !== null) {
      const record = detail as Record<string, unknown>;
      return {
        ...(typeof record.field === 'string' ? { field: record.field } : {}),
        message:
          typeof record.message === 'string'
            ? record.message
            : JSON.stringify(detail),
      };
    }

    return { message: String(detail) };
  });
}

/**
 * Collects domain-specific fields that are not part of the envelope itself.
 *
 * @param body - Exception response object.
 * @returns Extra fields, or `undefined` when the body only has envelope keys.
 */
function extraFields(
  body: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const extra = Object.fromEntries(
    Object.entries(body).filter(
      ([key]) =>
        !['code', 'message', 'details', 'statusCode', 'error'].includes(key),
    ),
  );

  return Object.keys(extra).length > 0 ? extra : undefined;
}

/** Stable fallback code for a status code. */
function codeForStatus(status: number): string {
  return CODE_BY_STATUS[status] ?? `http_${status}`;
}

/** Human-readable fallback message for a status code. */
function messageForStatus(status: number): string {
  return MESSAGE_BY_STATUS[status] ?? 'Request failed.';
}
