/**
 * A single validation/problem detail attached to an API error.
 *
 * `field` is a dotted path for validation errors (`profile.firstName`) and is
 * omitted for errors that are not field-specific.
 */
export interface ApiErrorDetail {
  field?: string;
  message: string;
}

/**
 * Machine-readable error body returned by every failing request.
 *
 * `code` is stable and safe to branch on; `message` is human-readable. Extra
 * domain context (for example the attribute keys a caller is missing) is
 * exposed through `meta` instead of being flattened into the envelope, so the
 * contract stays deterministic as new error types appear.
 */
export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: ApiErrorDetail[];
  meta?: Record<string, unknown>;
}
