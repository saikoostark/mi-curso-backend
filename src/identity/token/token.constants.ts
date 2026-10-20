/**
 * Token lifetimes, cookie attributes and cache keys.
 *
 * Access tokens are short-lived: immediate revocation relies on the cache
 * watermark/denylist (`RevocationService`), so they never outlive their TTL in
 * any meaningful way.
 */

/** Fallback access-token issuer when `JWT_ISSUER` is unset. */
export const DEFAULT_JWT_ISSUER = 'micurso';

/** Fallback access-token audience when `JWT_AUDIENCE` is unset. */
export const DEFAULT_JWT_AUDIENCE = 'micurso-api';

/** Access token lifetime in seconds. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/** Refresh token lifetime in milliseconds (rotated on every use). */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Email verification token lifetime in milliseconds. */
export const EMAIL_VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** Password reset token lifetime in milliseconds. */
export const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

/** Email-change approval token lifetime in milliseconds (sent to the old address). */
export const EMAIL_CHANGE_TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * How long expired rows are kept before the scheduled cleanup removes them.
 *
 * The retention past expiry keeps recent history available for debugging and
 * reuse detection without letting the tables grow forever.
 */

/** Retention for expired auth tokens (verification/reset links). */
export const AUTH_TOKEN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Retention for expired refresh tokens. */
export const REFRESH_TOKEN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Name of the httpOnly cookie carrying the refresh token. */
export const REFRESH_COOKIE_NAME = 'refresh_token';

/**
 * Path scope of the refresh cookie: every `/auth` route receives it, which
 * lets cookie-only clients log out (`POST /auth/logout/current`) and refresh
 * without exposing the cookie to the rest of the API.
 */
export const REFRESH_COOKIE_PATH = '/auth';

/** Pre-widening cookie path, cleared whenever the cookie is rewritten. */
export const LEGACY_REFRESH_COOKIE_PATH = '/auth/refresh';

/** Fallback active-session cap per account when the env var is missing. */
export const DEFAULT_MAX_ACTIVE_SESSIONS = 10;

/**
 * Cache key prefixes (all `auth:`-prefixed so e2e runs can safely clear only
 * their own keys in the dedicated test cache database).
 */

/** `auth:revoked-before:{userId}` -> ms timestamp watermark. */
export const REVOKED_BEFORE_KEY_PREFIX = 'auth:revoked-before:';

/**
 * Single sorted set holding every denylisted access token. Members are JTI
 * values scored by their expiry; pruning removes everything scored in the
 * past, so one key serves every revocation and the key TTL only has to outlive
 * the newest member.
 */
export const JTI_DENYLIST_KEY = 'auth:denylist';

/**
 * Idle lifetime of the denylist key, refreshed on every write.
 *
 * Equals the access-token lifetime: any member added earlier expires no later
 * than a full access-token lifetime after the newest write, so an idle key can
 * only disappear when every member is already dead.
 */
export const DENYLIST_IDLE_TTL_MS = ACCESS_TOKEN_TTL_SECONDS * 1000;

/** Fallback cap for live denylist entries when the env var is missing/invalid. */
export const DEFAULT_DENYLIST_MAX_SIZE = 100_000;

/** Fallback cleanup sweep interval when the env var is missing/invalid. */
export const DEFAULT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
