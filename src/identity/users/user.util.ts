/**
 * Normalizes an email address or username for storage and lookup.
 *
 * Both identifiers are case-insensitive: everything is compared and stored
 * trimmed and lowercased.
 *
 * @param value - Raw identifier as provided by the user.
 * @returns The normalized identifier.
 */
export function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Trims an optional free-text field, turning a blank value into `null`.
 *
 * Used by the profile DTO transforms so `"  "` clears a nullable column
 * instead of storing whitespace. Non-string values (including `null` and
 * `undefined`) pass through untouched, so validators can still distinguish
 * "omitted" from "explicitly cleared".
 *
 * @param value - Raw field value from the request.
 * @returns The trimmed value, `null` for blank strings, or the input as-is.
 */
export function trimOrNull(value: unknown): string | null | undefined {
  if (typeof value !== 'string') {
    return value as string | null | undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
