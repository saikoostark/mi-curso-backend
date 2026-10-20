import { SetMetadata } from '@nestjs/common';

/** Metadata key read by `ApiResponseInterceptor`. */
export const SKIP_API_ENVELOPE = 'skipApiEnvelope';

/**
 * Leaves the handler response untouched.
 *
 * Used for infrastructure endpoints (health, the root probe) whose raw body is
 * part of an external contract and must not be wrapped in the API envelope.
 */
export const SkipApiEnvelope = () => SetMetadata(SKIP_API_ENVELOPE, true);
