import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../../cache/cache.service.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  DEFAULT_DENYLIST_MAX_SIZE,
  DENYLIST_IDLE_TTL_MS,
  JTI_DENYLIST_KEY,
  REVOKED_BEFORE_KEY_PREFIX,
} from './token.constants.js';

/**
 * Cache-backed access-token revocation (the "denylist" half of the session
 * design).
 *
 * Two mechanisms cooperate:
 * - **Watermark** (`auth:revoked-before:{userId}`): a per-user millisecond
 *   timestamp. Logging out of all devices (or a password change) stamps it,
 *   and the guard rejects any access token whose `iat` predates it. Per-token
 *   entries are impossible for logout-all (other devices' tokens were never
 *   stored), so the watermark is what makes "logout everywhere" immediate. Its
 *   TTL equals the access-token lifetime: once it expires, every token
 *   predating it has expired too.
 * - **JTI denylist** (`auth:denylist`): one Redis sorted set holding targeted
 *   revocations (single device logout, "log out other devices"). Members are
 *   JTI values scored by the token's expiry; `pruneExpired` drops everything
 *   scored in the past. The key TTL is refreshed on every write
 *   (`DENYLIST_IDLE_TTL_MS`), so it can only expire when no member is alive.
 *
 * The set is capped (`AUTH_DENYLIST_MAX_SIZE`, default 100k): a write that
 * reaches the cap first prunes expired entries, and if live entries alone
 * exceed the cap a warning is logged. Live tokens are **never** evicted — an
 * eviction would silently re-enable a revoked token.
 *
 * Comparisons use the token's `iatMs` claim (millisecond precision): a token
 * minted before a revocation must die even when both happen within the same
 * second, and a token minted right after (a fresh login) must live. In a
 * multi-instance deployment this assumes NTP-synced clocks, like every
 * timestamp-based watermark.
 */
@Injectable()
export class RevocationService {
  private readonly logger = new Logger(RevocationService.name);
  private readonly maxSize: number;

  constructor(
    private readonly cache: CacheService,
    config: ConfigService,
  ) {
    this.maxSize = readPositiveInt(
      config.get<string>('AUTH_DENYLIST_MAX_SIZE'),
      DEFAULT_DENYLIST_MAX_SIZE,
    );
  }

  /**
   * Revokes every access token of the user issued before `at`.
   *
   * @param userId - User whose tokens to invalidate.
   * @param at - Revocation instant in milliseconds (defaults to now).
   */
  async revokeAllBefore(userId: string, at = Date.now()): Promise<void> {
    await this.cache.set(
      `${REVOKED_BEFORE_KEY_PREFIX}${userId}`,
      at,
      ACCESS_TOKEN_TTL_SECONDS * 1000,
    );
  }

  /**
   * Checks an access token against the user's watermark.
   *
   * @param userId - Token subject.
   * @param issuedAtMs - JWT `iatMs` claim (milliseconds).
   * @returns `true` when the token predates the last revocation.
   */
  async isRevoked(userId: string, issuedAtMs: number): Promise<boolean> {
    const revokedBefore = await this.cache.get<number>(
      `${REVOKED_BEFORE_KEY_PREFIX}${userId}`,
    );
    if (revokedBefore === null) {
      return false;
    }

    return issuedAtMs < revokedBefore;
  }

  /**
   * Denylists a single access token by id.
   *
   * The entry is scored with the token's own expiry, so it self-expires with
   * the token; `ttlSeconds` is not trusted beyond that.
   *
   * @param jti - JWT token id.
   * @param ttlSeconds - Remaining token lifetime in seconds (denylist entry
   * expires with it).
   */
  async denyJti(jti: string, ttlSeconds: number): Promise<void> {
    const expiresAtMs = Date.now() + Math.max(ttlSeconds, 0) * 1000;
    await this.cache.zadd(
      JTI_DENYLIST_KEY,
      expiresAtMs,
      jti,
      DENYLIST_IDLE_TTL_MS,
    );

    if ((await this.cache.zcard(JTI_DENYLIST_KEY)) >= this.maxSize) {
      await this.pruneExpired();
    }
  }

  /**
   * Checks whether a single access token id was denylisted.
   *
   * Entries scored in the past are ignored even when the prune has not run
   * yet.
   *
   * @param jti - JWT token id.
   * @returns `true` when the token must be rejected.
   */
  async isJtiDenied(jti: string): Promise<boolean> {
    const score = await this.cache.zscore(JTI_DENYLIST_KEY, jti);
    return score !== null && score > Date.now();
  }

  /**
   * Prunes denylist entries whose tokens have already expired.
   *
   * Called by the scheduled cleanup and by `denyJti` when the cap is reached.
   * Never removes a live entry: if the set is still at/over the cap after
   * pruning, a warning is logged instead (the cap is a safety valve, not a
   * reason to resurrect revoked tokens).
   *
   * @returns Number of pruned entries.
   */
  async pruneExpired(): Promise<number> {
    const removed = await this.cache.zremRangeByScore(
      JTI_DENYLIST_KEY,
      '-inf',
      Date.now(),
    );

    const size = await this.cache.zcard(JTI_DENYLIST_KEY);
    if (size >= this.maxSize) {
      this.logger.warn(
        `JTI denylist holds ${size} live entries (AUTH_DENYLIST_MAX_SIZE=${this.maxSize}); ` +
          'expired entries are pruned, but live tokens are never evicted.',
      );
    }

    return removed;
  }
}

/**
 * Parses a positive integer from a raw env value.
 *
 * @param raw - Raw value, when present.
 * @param fallback - Value used when missing, empty, non-numeric or <= 0.
 * @returns The parsed value or the fallback.
 */
function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
