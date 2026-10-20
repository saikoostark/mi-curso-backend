import type { ValidationError } from 'class-validator';
import type { ApiErrorDetail } from './api-error.js';

/**
 * Flattens class-validator's nested error tree into API details.
 *
 * Each constraint message becomes one detail with a dotted field path. Nested
 * DTO errors are walked recursively so the response stays useful even when
 * request payloads grow nested objects.
 *
 * @param errors - Validation errors from `ValidationPipe`.
 * @param parentPath - Prefix for the current level.
 * @returns Flat validation details.
 */
export function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): ApiErrorDetail[] {
  const details: ApiErrorDetail[] = [];

  for (const error of errors) {
    const field = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;

    for (const message of Object.values(error.constraints ?? {})) {
      details.push({ field, message });
    }

    if (error.children?.length) {
      details.push(...flattenValidationErrors(error.children, field));
    }
  }

  return details;
}
