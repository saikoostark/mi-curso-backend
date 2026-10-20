import { hashOpaqueToken } from '../token/token.util.js';
import { normalizeIdentity } from '../users/user.util.js';

/**
 * `auth:rl:{scope}:{kind}:{subject}` cache keys for the auth rate counters.
 *
 * All keys carry the `auth:rl:` prefix so e2e runs can clear exactly their own
 * keys in the dedicated test cache database. Flow services own their rules and
 * scopes (`login`, `register`, `forgot`, `resend`); these helpers only build
 * the keys.
 */
const RATE_LIMIT_KEY_PREFIX = 'auth:rl:';

/**
 * Key for a counter scoped to an email/username. The identifier is hashed
 * (after normalization), so it never sits in the cache in the clear.
 *
 * @param scope - Flow scope, e.g. `login`.
 * @param identifier - Email or username (normalized internally).
 * @returns The counter key.
 */
export function identifierLimitKey(scope: string, identifier: string): string {
  const digest = hashOpaqueToken(normalizeIdentity(identifier)).slice(0, 16);
  return `${RATE_LIMIT_KEY_PREFIX}${scope}:id:${digest}`;
}

/**
 * Key for a counter scoped to a client IP.
 *
 * @param scope - Flow scope, e.g. `reset`.
 * @param ip - Client IP.
 * @returns The counter key.
 */
export function ipLimitKey(scope: string, ip: string): string {
  return `${RATE_LIMIT_KEY_PREFIX}${scope}:ip:${ip}`;
}
