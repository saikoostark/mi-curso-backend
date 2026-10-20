import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import type { RateLimitRule } from '../../../rate-limit/rate-limiter.js';
import { RateLimiter } from '../../../rate-limit/rate-limiter.js';
import { PasswordService } from '../../password/password.service.js';
import { AuthTokenService } from '../../token/auth-token.service.js';
import { RefreshTokenService } from '../../token/refresh-token.service.js';
import { EMAIL_CHANGE_TOKEN_TTL_MS } from '../../token/token.constants.js';
import { TOKEN_ERRORS } from '../../token/token.error-codes.js';
import { toUserConflict } from '../../users/user-conflict.util.js';
import { normalizeIdentity } from '../../users/user.util.js';
import type { User } from '../../users/user.entity.js';
import { USER_ERRORS } from '../../users/users.error-codes.js';
import { UsersService } from '../../users/users.service.js';
import { AUTH_ERRORS } from '../auth.error-codes.js';
import { AuthMailerService } from '../auth-mailer.service.js';
import type { RequestMeta } from '../auth.types.js';
import { EmailVerificationService } from '../email-verification.service.js';
import { identifierLimitKey, ipLimitKey } from '../rate-limit-keys.js';
import type { ChangeEmailDto } from './dto/change-email.dto.js';
import { EmailChangeRequest } from './entities/email-change-request.entity.js';

/** Email changes: 3 per hour per account, 10 per hour per IP. */
const EMAIL_CHANGE_IDENTIFIER_RULE: RateLimitRule = {
  limit: 3,
  windowSeconds: 60 * 60,
};
const EMAIL_CHANGE_IP_RULE: RateLimitRule = {
  limit: 10,
  windowSeconds: 60 * 60,
};

/** Approval preview/POST: 20 attempts per hour per IP. */
const EMAIL_APPROVE_IP_RULE: RateLimitRule = {
  limit: 20,
  windowSeconds: 60 * 60,
};

/** Pending change exposed by `GET /auth/email`. */
export interface PendingEmailChangeView {
  newEmail: string;
  createdAt: string;
  expiresAt: string;
}

/** Non-mutating approval preview exposed by `GET /auth/email/approve`. */
export interface EmailChangePreviewView {
  newEmail: string;
  expiresAt: string;
}

/**
 * Two-sided email change for the authenticated account.
 *
 * A **verified** account still owns a confirmed address, so the change is
 * sequential: the new address is only recorded as a pending request and an
 * approval link goes to the *current* address. Approval swaps the email
 * unverified, revokes every session and sends the standard verification link
 * to the new address — the account proves ownership of the new address before
 * it can log in again.
 *
 * An **unverified** account has no confirmed address to protect: the email
 * changes immediately (still requiring the password), sessions are revoked and
 * the verification link goes to the new address.
 *
 * The password is always re-checked, so a stolen access token alone cannot
 * move the account to an attacker's address or spam the owner's mailbox.
 */
@Injectable()
export class EmailChangeService {
  constructor(
    @InjectRepository(EmailChangeRequest)
    private readonly requests: Repository<EmailChangeRequest>,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly authTokens: AuthTokenService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly emailVerification: EmailVerificationService,
    private readonly mailer: AuthMailerService,
    private readonly rateLimiter: RateLimiter,
  ) {}

  /**
   * Starts (or immediately completes) an email change.
   *
   * @param userId - Authenticated account.
   * @param dto - New address plus the current password.
   * @param meta - Request metadata (IP for rate limiting).
   * @returns Message plus whether sessions were revoked (verified accounts
   * keep their sessions until the owner approves).
   * @throws BadRequestException when the account vanished mid-flight, the
   * password is wrong or the address is unchanged.
   * @throws BadRequestException when the password is wrong or the address is
   * unchanged.
   * @throws ConflictException when another active account owns the address.
   */
  async request(
    userId: string,
    dto: ChangeEmailDto,
    meta: RequestMeta,
  ): Promise<{ message: string; sessionsRevoked: boolean }> {
    await this.rateLimiter.consume(
      identifierLimitKey('emailchange', userId),
      EMAIL_CHANGE_IDENTIFIER_RULE,
    );
    if (meta.ip) {
      await this.rateLimiter.consume(
        ipLimitKey('emailchange', meta.ip),
        EMAIL_CHANGE_IP_RULE,
      );
    }

    const user = await this.users.findById(userId);
    if (!user) {
      throw invalidToken();
    }

    const passwordValid = await this.passwords.verify(
      dto.password,
      user.passwordHash,
    );
    if (!passwordValid) {
      throw new BadRequestException({
        code: AUTH_ERRORS.invalidCurrentPassword,
        message: 'Current password is incorrect.',
      });
    }

    const newEmail = normalizeIdentity(dto.email);
    if (newEmail === user.email) {
      throw new BadRequestException({
        code: USER_ERRORS.emailUnchanged,
        message: 'The new email is the same as the current one.',
      });
    }

    await this.assertEmailFree(newEmail, userId);

    if (user.emailVerifiedAt === null) {
      await this.applyEmailChange(user, newEmail);
      return {
        message: 'Email updated. Verify your new address to continue.',
        sessionsRevoked: true,
      };
    }

    // Verified account: keep the old address until its owner approves. The
    // upsert (unique `userId`) makes a re-request a clean replacement, and
    // issuing the token invalidates the previous approval link.
    await this.requests.upsert(
      {
        userId,
        newEmail,
        expiresAt: new Date(Date.now() + EMAIL_CHANGE_TOKEN_TTL_MS),
      },
      ['userId'],
    );
    const token = await this.authTokens.issue(
      userId,
      'email_change_old',
      EMAIL_CHANGE_TOKEN_TTL_MS,
    );
    await this.mailer.sendEmailChangeApproval(user.email, newEmail, token);

    return {
      message: 'Approval email sent to your current address.',
      sessionsRevoked: false,
    };
  }

  /**
   * Cancels a pending email change (idempotent).
   *
   * @param userId - Authenticated account.
   * @returns Success message.
   */
  async cancel(userId: string): Promise<{ message: string }> {
    await this.purgeForUser(userId);
    return { message: 'Email change cancelled.' };
  }

  /**
   * Returns the caller's pending change, if it is still usable.
   *
   * @param userId - Authenticated account.
   * @returns The pending change, or `null` when none exists or it expired.
   */
  async getPending(userId: string): Promise<PendingEmailChangeView | null> {
    const pending = await this.requests.findOne({ where: { userId } });
    if (!pending || pending.expiresAt.getTime() <= Date.now()) {
      return null;
    }

    return {
      newEmail: pending.newEmail,
      createdAt: pending.createdAt.toISOString(),
      expiresAt: pending.expiresAt.toISOString(),
    };
  }

  /**
   * Previews an approval link without consuming it.
   *
   * Mail scanners commonly fetch email links; a preview must therefore have no
   * side effects. It only proves the token and the pending handshake are still
   * usable and returns the address the user is about to accept.
   *
   * @param token - Raw `email_change_old` token from the approval link.
   * @param meta - Request metadata (IP for rate limiting).
   * @returns The pending new address and expiry.
   * @throws BadRequestException when the link is invalid, used or expired.
   */
  async preview(
    token: string,
    meta: RequestMeta,
  ): Promise<EmailChangePreviewView> {
    await this.consumeApprovalLimit(meta);

    const userId = await this.authTokens.preview(token, 'email_change_old');
    const pending = await this.requests.findOne({ where: { userId } });

    if (!pending || pending.expiresAt.getTime() <= Date.now()) {
      throw invalidToken();
    }

    return {
      newEmail: pending.newEmail,
      expiresAt: pending.expiresAt.toISOString(),
    };
  }

  /**
   * Approves a pending change from the link sent to the current address.
   *
   * The token is single-use; the pending row is the second half of the
   * handshake and must still exist and be unexpired. On success the email is
   * swapped unverified, every session is revoked and the verification link
   * goes to the new address.
   *
   * @param token - Raw `email_change_old` token from the approval link.
   * @param meta - Request metadata (IP for rate limiting).
   * @returns Success message.
   * @throws BadRequestException when the link is invalid, used or expired.
   * @throws ConflictException when another account claimed the new address in
   * the meantime.
   */
  async approve(
    token: string,
    meta: RequestMeta,
  ): Promise<{ message: string }> {
    await this.consumeApprovalLimit(meta);

    const userId = await this.authTokens.consume(token, 'email_change_old');
    const pending = await this.requests.findOne({ where: { userId } });

    if (!pending || pending.expiresAt.getTime() <= Date.now()) {
      if (pending) {
        await this.requests.delete({ id: pending.id });
      }
      throw invalidToken();
    }

    const user = await this.users.findById(userId);
    if (!user) {
      await this.requests.delete({ id: pending.id });
      throw invalidToken();
    }

    if (user.email === pending.newEmail) {
      // The swap already happened (for example an admin override); the link is
      // spent, but the request is satisfied.
      await this.requests.delete({ id: pending.id });
      return { message: 'Email already updated. Verify your new address.' };
    }

    const owner = await this.users.findByEmail(pending.newEmail);
    if (owner && owner.id !== userId) {
      await this.requests.delete({ id: pending.id });
      throw new ConflictException({
        code: USER_ERRORS.emailTaken,
        message: 'This email is already registered.',
      });
    }

    await this.applyEmailChange(user, pending.newEmail);
    return { message: 'Email updated. Verify your new address.' };
  }

  /**
   * Removes any pending change together with its approval link.
   *
   * Used when the account is soft-deleted (a restore must not resurrect a
   * stale change) and when an admin overrides the email: the link the user may
   * still hold must stop working, otherwise approving it would silently undo
   * the admin's decision.
   *
   * @param userId - Account whose pending change to discard.
   */
  async purgeForUser(userId: string): Promise<void> {
    await this.requests.delete({ userId });
    await this.authTokens.invalidatePending(userId, 'email_change_old');
  }

  /**
   * Deletes expired pending requests. They are unusable (the approval token
   * expires in lockstep), so no retention window applies.
   *
   * @returns Number of deleted rows.
   */
  async purgeExpired(): Promise<number> {
    const result = await this.requests.delete({
      expiresAt: LessThan(new Date()),
    });
    return result.affected ?? 0;
  }

  /**
   * Applies a new email to the account and starts its verification.
   *
   * Shared by the immediate (unverified account) and approved paths: store the
   * normalized address with `emailVerifiedAt = null`, drop pending approval
   * state, revoke every session and mail the verification link.
   *
   * @param user - Account to update.
   * @param newEmail - Normalized replacement address.
   */
  private async applyEmailChange(user: User, newEmail: string): Promise<void> {
    user.email = newEmail;
    user.emailVerifiedAt = null;

    try {
      await this.users.save(user);
    } catch (error) {
      throw toUserConflict(error) ?? error;
    }

    await this.requests.delete({ userId: user.id });
    await this.authTokens.invalidatePending(user.id, 'email_change_old');
    // A reset link sent to the old address must not survive the identity move:
    // whoever controlled that mailbox could otherwise reset the password.
    await this.authTokens.invalidatePending(user.id, 'password_reset');
    await this.refreshTokens.revokeAllForUser(user.id);
    await this.emailVerification.sendVerificationTo(user.id, newEmail);
  }

  /**
   * Throws 409 when an active account other than this one owns the address.
   *
   * @param email - Normalized candidate address.
   * @param userId - Account requesting the change.
   */
  private async assertEmailFree(email: string, userId: string): Promise<void> {
    const owner = await this.users.findByEmail(email);
    if (owner && owner.id !== userId) {
      throw new ConflictException({
        code: USER_ERRORS.emailTaken,
        message: 'This email is already registered.',
      });
    }
  }

  /**
   * Applies the per-IP approval budget shared by preview and approval.
   *
   * @param meta - Request metadata.
   */
  private async consumeApprovalLimit(meta: RequestMeta): Promise<void> {
    if (meta.ip) {
      await this.rateLimiter.consume(
        ipLimitKey('emailapprove', meta.ip),
        EMAIL_APPROVE_IP_RULE,
      );
    }
  }
}

/** Uniform 400 for every unusable approval link. */
function invalidToken(): BadRequestException {
  return new BadRequestException({
    code: TOKEN_ERRORS.invalidToken,
    message: 'This link is invalid or has expired.',
  });
}
