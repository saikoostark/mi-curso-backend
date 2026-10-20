import { Injectable } from '@nestjs/common';
import { AuthTokenService } from '../token/auth-token.service.js';
import { PASSWORD_RESET_TOKEN_TTL_MS } from '../token/token.constants.js';
import { AuthMailerService } from './auth-mailer.service.js';

/**
 * Issues password-reset links on behalf of flows that already decided a reset
 * is required (forgot-password and admin restore).
 *
 * Keeping this in one place makes the token TTL and the email template
 * consistent; the actual password update still goes through
 * `PasswordUpdateService`, so every reset revokes sessions.
 */
@Injectable()
export class PasswordResetService {
  constructor(
    private readonly authTokens: AuthTokenService,
    private readonly mailer: AuthMailerService,
  ) {}

  /**
   * Issues a fresh single-use reset token and mails the link.
   *
   * Issuing invalidates any pending reset link for the account, so only the
   * newest email works.
   *
   * @param userId - Account that must reset its password.
   * @param email - Destination address (the account's current address).
   */
  async sendResetLink(userId: string, email: string): Promise<void> {
    const token = await this.authTokens.issue(
      userId,
      'password_reset',
      PASSWORD_RESET_TOKEN_TTL_MS,
    );
    await this.mailer.sendResetEmail(email, token);
  }
}
