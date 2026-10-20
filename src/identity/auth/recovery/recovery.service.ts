import { BadRequestException, Injectable } from '@nestjs/common';
import type { RateLimitRule } from '../../../rate-limit/rate-limiter.js';
import { RateLimiter } from '../../../rate-limit/rate-limiter.js';
import { AuthTokenService } from '../../token/auth-token.service.js';
import { TOKEN_ERRORS } from '../../token/token.error-codes.js';
import { normalizeIdentity } from '../../users/user.util.js';
import { UsersService } from '../../users/users.service.js';
import type { RequestMeta } from '../auth.types.js';
import { PasswordUpdateService } from '../account/password-update.service.js';
import { PasswordResetService } from '../password-reset.service.js';
import { identifierLimitKey, ipLimitKey } from '../rate-limit-keys.js';

/** Forgot password: 3 reset emails per hour per identifier, 10 per hour per IP. */
const FORGOT_IDENTIFIER_RULE: RateLimitRule = {
  limit: 3,
  windowSeconds: 60 * 60,
};
const FORGOT_IP_RULE: RateLimitRule = { limit: 10, windowSeconds: 60 * 60 };

/**
 * The recovery journey: start the forgot-password flow (always a generic
 * answer, so account existence is not revealed) and complete it with the token
 * from the emailed link.
 *
 * Completion shares the password-update tail with the account flow — every
 * session is revoked, so all devices must log in again.
 */
@Injectable()
export class RecoveryService {
  constructor(
    private readonly users: UsersService,
    private readonly authTokens: AuthTokenService,
    private readonly passwordReset: PasswordResetService,
    private readonly rateLimiter: RateLimiter,
    private readonly passwordUpdate: PasswordUpdateService,
  ) {}

  /**
   * Starts the forgot-password flow.
   *
   * @param identifier - Email or username.
   * @param meta - Request metadata (IP for rate limiting).
   * @returns Generic message.
   */
  async forgotPassword(
    identifier: string,
    meta: RequestMeta,
  ): Promise<{ message: string }> {
    await this.rateLimiter.consume(
      identifierLimitKey('forgot', identifier),
      FORGOT_IDENTIFIER_RULE,
    );
    if (meta.ip) {
      await this.rateLimiter.consume(
        ipLimitKey('forgot', meta.ip),
        FORGOT_IP_RULE,
      );
    }

    const user = await this.users.findByIdentifier(
      normalizeIdentity(identifier),
    );
    if (user) {
      await this.passwordReset.sendResetLink(user.id, user.email);
    }

    return {
      message:
        'If an account exists for that email or username, a password reset email has been sent.',
    };
  }

  /**
   * Completes the forgot-password flow with a new password.
   *
   * @param token - Raw token from the reset link.
   * @param newPassword - New password.
   * @param passwordConfirm - Confirmation of the new password.
   * @returns Success message.
   * @throws BadRequestException when the token is invalid or the policy fails.
   */
  async resetPassword(
    token: string,
    newPassword: string,
    passwordConfirm: string,
  ): Promise<{ message: string }> {
    const userId = await this.authTokens.consume(token, 'password_reset');

    const user = await this.users.findById(userId);
    if (!user) {
      throw new BadRequestException({
        code: TOKEN_ERRORS.invalidToken,
        message: 'This link is invalid or has expired.',
      });
    }

    await this.passwordUpdate.updatePassword(
      user,
      newPassword,
      passwordConfirm,
    );

    return { message: 'Password has been reset. You can now log in.' };
  }
}
