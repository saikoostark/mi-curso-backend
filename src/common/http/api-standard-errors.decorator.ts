import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiErrorResponseDto } from './api-error.dto.js';

/**
 * Documents the error statuses the API can return.
 *
 * Applied at controller level so every operation inherits the common error
 * schema; operation-specific errors keep their own decorators.
 */
export function ApiStandardErrors(): ClassDecorator & MethodDecorator {
  return applyDecorators(
    ApiBadRequestResponse({
      type: ApiErrorResponseDto,
      description: 'Validation failed or the request is malformed.',
    }),
    ApiUnauthorizedResponse({
      type: ApiErrorResponseDto,
      description: 'Authentication is missing or the token is invalid.',
    }),
    ApiForbiddenResponse({
      type: ApiErrorResponseDto,
      description: 'The caller lacks the required capability.',
    }),
    ApiNotFoundResponse({
      type: ApiErrorResponseDto,
      description: 'The requested resource does not exist.',
    }),
    ApiConflictResponse({
      type: ApiErrorResponseDto,
      description: 'The change conflicts with existing data.',
    }),
    ApiTooManyRequestsResponse({
      type: ApiErrorResponseDto,
      description: 'A rate limit was exceeded.',
    }),
    ApiInternalServerErrorResponse({
      type: ApiErrorResponseDto,
      description: 'An unexpected server error occurred.',
    }),
  ) as ClassDecorator & MethodDecorator;
}
