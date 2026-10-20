/**
 * Ambient request information stored alongside tokens for audit purposes.
 */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

/**
 * A freshly issued token pair. `refreshToken` travels only in the httpOnly
 * cookie; `accessToken` is returned in the response body (kept in JS memory by
 * the client).
 */
export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Normalizes Express request metadata for the auth services.
 *
 * @param ip - Client IP, when known.
 * @param userAgent - User agent header, when present.
 * @returns Request metadata with nulls instead of undefined.
 */
export function requestMeta(
  ip: string | undefined,
  userAgent: string | undefined,
): RequestMeta {
  return { ip: ip ?? null, userAgent: userAgent ?? null };
}
