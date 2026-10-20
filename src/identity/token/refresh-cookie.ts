import type { Request, Response } from 'express';
import {
  LEGACY_REFRESH_COOKIE_PATH,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  REFRESH_TOKEN_TTL_MS,
} from './token.constants.js';

/**
 * HTTP cookie handling for the refresh token.
 *
 * The cookie is httpOnly (invisible to JavaScript), SameSite=Strict (CSRF
 * protection), `Secure` in production, and path-scoped to `/auth` so cookie-only
 * clients can reach refresh/logout without leaking the token to other routes.
 * The old `/auth/refresh` path is cleared whenever the cookie is written or
 * removed, so pre-widening cookies cannot shadow the new one.
 */

/**
 * Writes the refresh token into its cookie.
 *
 * @param response - Express response.
 * @param token - Raw refresh token.
 */
export function setRefreshCookie(response: Response, token: string): void {
  // Clear the pre-widening cookie first: some cookie jars key by name and
  // would otherwise drop the freshly written value.
  response.clearCookie(REFRESH_COOKIE_NAME, {
    path: LEGACY_REFRESH_COOKIE_PATH,
  });
  response.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_TTL_MS,
  });
}

/**
 * Removes the refresh cookie (logout, password change/reset), including the
 * legacy path.
 *
 * @param response - Express response.
 */
export function clearRefreshCookie(response: Response): void {
  response.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
  response.clearCookie(REFRESH_COOKIE_NAME, {
    path: LEGACY_REFRESH_COOKIE_PATH,
  });
}

/**
 * Reads the refresh token from the request cookies.
 *
 * @param request - Express request (populated by cookie-parser).
 * @returns The raw token, or `undefined` when absent.
 */
export function readRefreshCookie(request: Request): string | undefined {
  const value: unknown = request.cookies?.[REFRESH_COOKIE_NAME];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
