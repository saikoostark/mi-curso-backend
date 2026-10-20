import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import {
  REFRESH_TOKEN_RETENTION_MS,
  REFRESH_TOKEN_TTL_MS,
} from './token.constants.js';
import { TOKEN_ERRORS } from './token.error-codes.js';
import type { RequestMeta } from '../auth/auth.types.js';
import { RefreshToken } from './entities/refresh-token.entity.js';
import { RevocationService } from './revocation.service.js';
import { generateOpaqueToken, hashOpaqueToken } from './token.util.js';

/**
 * The access token issued together with a refresh session, as stored on the
 * ledger row so the exact token can be revoked later.
 */
export interface AccessTokenJournal {
  /** Access token id (`jti` claim). */
  jti: string;
  /** Millisecond expiry of the access token. */
  expiresAtMs: number;
}

/**
 * Manages the refresh-token ledger with rotation and reuse detection.
 *
 * Rotation is claimed atomically (`UPDATE ... WHERE revokedAt IS NULL`) so
 * concurrent refreshes cannot mint two successors; the loser is treated as
 * reuse. Presenting any already-revoked token is treated as theft: every
 * refresh token *and* access token of the user is revoked.
 *
 * Every active row also carries the access token minted for the same session
 * (`accessJti`/`accessExpiresAt`). Targeted actions — logout of one device,
 * "log out other devices" — revoke the refresh row and denylist that access
 * token for exactly its remaining lifetime; the watermark is deliberately not
 * used there, because it would also kill the caller's own token.
 */
@Injectable()
export class RefreshTokenService {
  constructor(
    @InjectRepository(RefreshToken)
    private readonly repository: Repository<RefreshToken>,
    private readonly revocation: RevocationService,
  ) {}

  /**
   * Issues a new refresh token for a login session.
   *
   * @param userId - Owning user.
   * @param meta - Client ip / user agent for audit.
   * @param access - Access token journal entry minted for the same session.
   * @returns The raw token (only its hash is stored).
   */
  async issue(
    userId: string,
    meta: RequestMeta,
    access: AccessTokenJournal,
  ): Promise<string> {
    const token = generateOpaqueToken();

    await this.repository.save(
      this.repository.create({
        userId,
        tokenHash: hashOpaqueToken(token),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        revokedAt: null,
        replacedByHash: null,
        accessJti: access.jti,
        accessExpiresAt: new Date(access.expiresAtMs),
        userAgent: meta.userAgent,
        ip: meta.ip,
        lastUsedAt: new Date(),
      }),
    );

    return token;
  }

  /**
   * Rotates a refresh token: revokes the presented one and issues a successor.
   *
   * The successor row starts without an access journal because the caller must
   * sign the new access token first (it needs the owner id this method
   * resolves); `attachAccess` links the two immediately afterwards.
   *
   * @param rawToken - Refresh token from the cookie.
   * @param meta - Client ip / user agent for audit.
   * @returns Owner id, successor session id and the new raw token.
   * @throws UnauthorizedException when the token is unknown, expired, already
   * rotated (reuse) or lost a concurrent race.
   */
  async rotate(
    rawToken: string,
    meta: RequestMeta,
  ): Promise<{ userId: string; sessionId: string; token: string }> {
    const tokenHash = hashOpaqueToken(rawToken);
    const existing = await this.repository.findOne({ where: { tokenHash } });

    if (!existing) {
      throw invalidRefreshToken();
    }

    if (existing.revokedAt !== null) {
      // Reuse of a *rotated* token means two parties hold the same secret:
      // assume theft and kill every session. A token revoked by an explicit
      // logout/revoke is merely stale — presenting it must not nuke the other
      // devices the user is still signed in on.
      if (existing.replacedByHash !== null) {
        await this.revokeAllForUser(existing.userId);
      }
      throw invalidRefreshToken();
    }

    if (existing.expiresAt.getTime() <= Date.now()) {
      throw invalidRefreshToken();
    }

    const nextToken = generateOpaqueToken();
    const nextHash = hashOpaqueToken(nextToken);

    // Atomic claim: only the first of two concurrent refreshes updates the row.
    const claim = await this.repository.update(
      { id: existing.id, revokedAt: IsNull() },
      { revokedAt: new Date(), replacedByHash: nextHash },
    );
    if (claim.affected !== 1) {
      await this.revokeAllForUser(existing.userId);
      throw invalidRefreshToken();
    }

    const successor = await this.repository.save(
      this.repository.create({
        userId: existing.userId,
        tokenHash: nextHash,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        revokedAt: null,
        replacedByHash: null,
        accessJti: null,
        accessExpiresAt: null,
        userAgent: meta.userAgent,
        ip: meta.ip,
        lastUsedAt: new Date(),
      }),
    );

    return {
      userId: existing.userId,
      sessionId: successor.id,
      token: nextToken,
    };
  }

  /**
   * Links the access token minted for a just-rotated session to its row.
   *
   * @param sessionId - Refresh-token row id (the session).
   * @param access - Access token journal entry.
   */
  async attachAccess(
    sessionId: string,
    access: AccessTokenJournal,
  ): Promise<void> {
    await this.repository.update(
      { id: sessionId },
      {
        accessJti: access.jti,
        accessExpiresAt: new Date(access.expiresAtMs),
      },
    );
  }

  /**
   * Lists the user's active sessions (not revoked, not expired), newest
   * first, with a stable tie-breaker for equal timestamps.
   *
   * @param userId - Session owner.
   * @returns Active ledger rows.
   */
  listActiveForUser(userId: string): Promise<RefreshToken[]> {
    return this.repository.find({
      where: {
        userId,
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
  }

  /**
   * Finds the active session a given access token belongs to.
   *
   * @param userId - Session owner.
   * @param accessJti - Access token id from the caller's JWT.
   * @returns The row or `null` (for example tokens minted before the journal
   * existed).
   */
  findActiveByAccessJti(
    userId: string,
    accessJti: string,
  ): Promise<RefreshToken | null> {
    return this.repository.findOne({
      where: { userId, accessJti, revokedAt: IsNull() },
    });
  }

  /**
   * Revokes one specific active session.
   *
   * The claim is atomic, so two concurrent revocations of the same session
   * cannot both report success; the loser gets `null` and maps it to 404.
   *
   * @param userId - Session owner (must match the row).
   * @param sessionId - Refresh-token row id.
   * @returns The revoked row, or `null` when it was unknown/expired/revoked.
   */
  async revokeSession(
    userId: string,
    sessionId: string,
  ): Promise<RefreshToken | null> {
    const row = await this.repository.findOne({
      where: { id: sessionId, userId },
    });

    if (
      !row ||
      row.revokedAt !== null ||
      row.expiresAt.getTime() <= Date.now()
    ) {
      return null;
    }

    const claim = await this.repository.update(
      { id: sessionId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );

    return claim.affected === 1 ? row : null;
  }

  /**
   * Revokes the active session a raw refresh token belongs to.
   *
   * Used by cookie-only `POST /auth/logout/current`: possession of the cookie
   * is the credential. Unlike rotation, presenting an already-revoked token is
   * not treated as reuse/theft — it is merely an unusable session.
   *
   * @param rawToken - Refresh token from the cookie.
   * @returns The revoked row (its access token is denylisted), or `null` when
   * the token is unknown, revoked or expired.
   */
  async revokeByRawToken(rawToken: string): Promise<RefreshToken | null> {
    const tokenHash = hashOpaqueToken(rawToken);
    const row = await this.repository.findOne({ where: { tokenHash } });

    if (
      !row ||
      row.revokedAt !== null ||
      row.expiresAt.getTime() <= Date.now()
    ) {
      return null;
    }

    const claim = await this.repository.update(
      { id: row.id, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    if (claim.affected !== 1) {
      return null;
    }

    await this.denyAccessTokenOf(row);
    return row;
  }

  /**
   * Enforces the per-account active-session cap by revoking the oldest rows.
   *
   * Called right after a login issues its session, so the new session (the
   * newest) is never the one evicted. Each evicted row's access token is
   * denylisted individually; the watermark is not used because it would also
   * kill the session that just logged in.
   *
   * @param userId - Session owner.
   * @param max - Maximum number of active sessions to keep.
   * @returns Number of sessions revoked.
   */
  async enforceLimit(userId: string, max: number): Promise<number> {
    if (!Number.isInteger(max) || max <= 0) {
      return 0;
    }

    const active = await this.listActiveForUser(userId);
    const excess = active.slice(max);
    let revoked = 0;

    for (const row of excess) {
      const claim = await this.repository.update(
        { id: row.id, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );

      if (claim.affected === 1) {
        revoked += 1;
        await this.denyAccessTokenOf(row);
      }
    }

    return revoked;
  }

  /**
   * Revokes every active session except the caller's own.
   *
   * The caller is identified by the `jti` of the access token on the request,
   * not by a session id (the client never handles session ids for this). Since
   * the watermark would also kill the caller's token, each revoked row's
   * access token is denylisted individually for its remaining lifetime.
   *
   * @param userId - Session owner.
   * @param currentJti - Access token id of the caller's own session.
   * @returns Number of sessions revoked.
   */
  async revokeOtherSessions(
    userId: string,
    currentJti: string,
  ): Promise<number> {
    const active = await this.listActiveForUser(userId);
    let revoked = 0;

    for (const row of active) {
      if (row.accessJti === currentJti) {
        continue;
      }

      const claim = await this.repository.update(
        { id: row.id, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );

      if (claim.affected === 1) {
        revoked += 1;
        await this.denyAccessTokenOf(row);
      }
    }

    return revoked;
  }

  /**
   * Denylists the access token a revoked session row carried, for exactly its
   * remaining lifetime.
   *
   * Safe to call on rows without a journal entry (nothing to deny) and on
   * tokens that already expired (nothing to do).
   *
   * @param row - Refresh-token row (typically just revoked).
   */
  async denyAccessTokenOf(row: RefreshToken): Promise<void> {
    if (!row.accessJti || !row.accessExpiresAt) {
      return;
    }

    await this.denyAccessJti(row.accessJti, row.accessExpiresAt.getTime());
  }

  /**
   * Denylists a single access token for its remaining lifetime.
   *
   * @param jti - Access token id.
   * @param expiresAtMs - Millisecond expiry of the token.
   */
  async denyAccessJti(jti: string, expiresAtMs: number): Promise<void> {
    const remainingMs = expiresAtMs - Date.now();
    if (remainingMs <= 0) {
      return;
    }

    await this.revocation.denyJti(jti, Math.ceil(remainingMs / 1000));
  }

  /**
   * Revokes every refresh token of the user and stamps the access-token
   * watermark — the complete "logout everywhere" primitive.
   *
   * @param userId - User whose sessions to revoke.
   */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.repository.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    await this.revocation.revokeAllBefore(userId);
  }

  /**
   * Deletes every refresh-token row of the user.
   *
   * Used when the account itself is soft-deleted (sessions are ephemeral state
   * and must not survive a restore) — the revocation watermark is stamped
   * separately by the calling flow.
   *
   * @param userId - User whose rows to delete.
   */
  async purgeForUser(userId: string): Promise<void> {
    await this.repository.delete({ userId });
  }

  /**
   * Deletes rows whose `expiresAt` passed beyond the retention window.
   *
   * Rotation keeps history for reuse detection, so expired rows are not
   * removed until they are old enough that no in-flight request can reference
   * them.
   *
   * @returns Number of deleted rows.
   */
  async purgeExpired(): Promise<number> {
    const cutoff = new Date(Date.now() - REFRESH_TOKEN_RETENTION_MS);
    const result = await this.repository.delete({
      expiresAt: LessThan(cutoff),
    });
    return result.affected ?? 0;
  }
}

/**
 * Uniform 401 for every unusable refresh token. The reason (unknown, expired,
 * reused) is intentionally not disclosed.
 */
function invalidRefreshToken(): UnauthorizedException {
  return new UnauthorizedException({
    code: TOKEN_ERRORS.invalidRefreshToken,
    message: 'Invalid or expired refresh token.',
  });
}
