import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ATTRIBUTE_ERRORS } from '../../identity/attributes/attributes.error-codes.js';
import { ApiExceptionFilter } from './api-exception.filter.js';
import { COMMON_ERROR_CODES } from './error-codes.js';

/**
 * Builds an Express response double and a matching arguments host.
 *
 * @returns The response mock and the host passed to the filter.
 */
function makeHost(): {
  response: Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
  host: ArgumentsHost;
} {
  const response = {
    headersSent: false,
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);

  return {
    response: response as unknown as Response & {
      status: ReturnType<typeof vi.fn>;
      json: ReturnType<typeof vi.fn>;
    },
    host: {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost,
  };
}

describe('ApiExceptionFilter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves domain codes and moves extra context into meta', () => {
    const { response, host } = makeHost();

    new ApiExceptionFilter().catch(
      new ForbiddenException({
        code: ATTRIBUTE_ERRORS.insufficientAttributes,
        message: 'You do not have the required attributes.',
        required: ['users:read'],
      }),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: ATTRIBUTE_ERRORS.insufficientAttributes,
        message: 'You do not have the required attributes.',
        meta: { required: ['users:read'] },
      },
    });
  });

  it('normalizes string exceptions to a stable code', () => {
    const { response, host } = makeHost();

    new ApiExceptionFilter().catch(
      new BadRequestException('Validation failed (uuid is expected)'),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: COMMON_ERROR_CODES.badRequest,
        message: 'Validation failed (uuid is expected)',
      },
    });
  });

  it('keeps structured validation details', () => {
    const { response, host } = makeHost();

    new ApiExceptionFilter().catch(
      new BadRequestException({
        code: COMMON_ERROR_CODES.validationFailed,
        message: 'Validation failed.',
        details: [{ field: 'email', message: 'email must be an email' }],
      }),
      host,
    );

    expect(response.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: COMMON_ERROR_CODES.validationFailed,
        message: 'Validation failed.',
        details: [{ field: 'email', message: 'email must be an email' }],
      },
    });
  });

  it('hides unexpected errors behind a generic 500', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { response, host } = makeHost();

    new ApiExceptionFilter().catch(new Error('database exploded'), host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: COMMON_ERROR_CODES.internalError,
        message: 'Internal server error.',
      },
    });
  });
});
