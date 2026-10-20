import { createHash, randomBytes } from 'node:crypto';

/**
 * Creates a high-entropy opaque token (refresh tokens, email-verification and
 * password-reset links).
 *
 * @returns 32 random bytes, base64url-encoded.
 */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * SHA-256 hash used to store opaque tokens at rest. Tokens are high-entropy
 * random values, so a fast hash is sufficient (and lets lookups stay indexed).
 *
 * @param token - Raw token as handed to the client.
 * @returns Hex-encoded SHA-256 digest.
 */
export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
