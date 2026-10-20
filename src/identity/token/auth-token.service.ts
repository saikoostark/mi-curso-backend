import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import { AuthToken, AuthTokenType } from './entities/auth-token.entity.js';
import { AUTH_TOKEN_RETENTION_MS } from './token.constants.js';
import { TOKEN_ERRORS } from './token.error-codes.js';
import { generateOpaqueToken, hashOpaqueToken } from './token.util.js';

/**
 * Issues and consumes the single-use links used for email verification and
 * password reset.
 */
@Injectable()
export class AuthTokenService {
  constructor(
    @InjectRepository(AuthToken)
    private readonly repository: Repository<AuthToken>,
  ) {}

  /**
   * Issues a new token of the given type, invalidating any pending predecessor
   * (only the newest link ever works).
   *
   * @param userId - Owner of the token.
   * @param type - Token purpose.
   * @param ttlMs - Lifetime in milliseconds.
   * @returns The raw token for the email link.
   */
  async issue(
    userId: string,
    type: AuthTokenType,
    ttlMs: number,
  ): Promise<string> {
    await this.invalidatePending(userId, type);

    const token = generateOpaqueToken();
    await this.repository.save(
      this.repository.create({
        userId,
        type,
        tokenHash: hashOpaqueToken(token),
        expiresAt: new Date(Date.now() + ttlMs),
        consumedAt: null,
      }),
    );

    return token;
  }

  /**
   * Consumes a token, returning its owner.
   *
   * The claim is a single conditional `UPDATE ... RETURNING`: two concurrent
   * requests presenting the same link cannot both succeed. The database clock
   * decides expiry, so application clock skew cannot extend a link either.
   *
   * @param token - Raw token from the email link.
   * @param type - Expected token purpose.
   * @returns Owning user id.
   * @throws BadRequestException when the token is unknown, used or expired.
   */
  async consume(token: string, type: AuthTokenType): Promise<string> {
    const tokenHash = hashOpaqueToken(token);
    const raw = await this.repository.query<unknown>(
      `UPDATE "auth_tokens"
          SET "consumedAt" = now()
        WHERE "tokenHash" = $1
          AND "type" = $2
          AND "consumedAt" IS NULL
          AND "expiresAt" > now()
        RETURNING "userId"`,
      [tokenHash, type],
    );

    // Postgres returns `[rows, affected]` for UPDATE, while a mocked/other
    // driver may return the rows directly. Accept both shapes.
    const rows = (
      Array.isArray(raw) && Array.isArray(raw[0]) ? raw[0] : raw
    ) as Array<{ userId?: unknown }>;
    const first = Array.isArray(rows) ? rows[0] : undefined;
    if (!first || typeof first.userId !== 'string') {
      throw invalidToken();
    }

    return first.userId;
  }

  /**
   * Resolves the owner of a usable token without consuming it.
   *
   * Used by the email-change approval preview: opening the link in a browser
   * (or a mail scanner prefetching it) must not complete the state change. The
   * actual approval still calls `consume`, so a preview followed by two
   * approvals remains single-use.
   *
   * @param token - Raw token from the email link.
   * @param type - Expected token purpose.
   * @returns Owning user id.
   * @throws BadRequestException when the token is unknown, used or expired.
   */
  async preview(token: string, type: AuthTokenType): Promise<string> {
    const tokenHash = hashOpaqueToken(token);
    const row = await this.repository.findOne({
      where: { tokenHash, type },
    });

    if (
      !row ||
      row.consumedAt !== null ||
      row.expiresAt.getTime() <= Date.now()
    ) {
      throw invalidToken();
    }

    return row.userId;
  }

  /**
   * Invalidates every pending token of a type (e.g. after the password was
   * actually reset, stale reset links must stop working).
   *
   * @param userId - Token owner.
   * @param type - Token purpose.
   */
  async invalidatePending(userId: string, type: AuthTokenType): Promise<void> {
    await this.repository.update(
      { userId, type, consumedAt: IsNull() },
      { consumedAt: new Date() },
    );
  }

  /**
   * Deletes every token row of the user (soft deletion: pending links are
   * ephemeral state and must not survive a restore).
   *
   * @param userId - Token owner.
   */
  async purgeForUser(userId: string): Promise<void> {
    await this.repository.delete({ userId });
  }

  /**
   * Deletes rows whose `expiresAt` passed beyond the retention window.
   *
   * @returns Number of deleted rows.
   */
  async purgeExpired(): Promise<number> {
    const cutoff = new Date(Date.now() - AUTH_TOKEN_RETENTION_MS);
    const result = await this.repository.delete({
      expiresAt: LessThan(cutoff),
    });
    return result.affected ?? 0;
  }
}

/** Uniform 400 for every unusable link. */
function invalidToken(): BadRequestException {
  return new BadRequestException({
    code: TOKEN_ERRORS.invalidToken,
    message: 'This link is invalid or has expired.',
  });
}
