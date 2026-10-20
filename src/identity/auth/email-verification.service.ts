import { Injectable } from '@nestjs/common';
import { AuthTokenService } from '../token/auth-token.service.js';
import { EMAIL_VERIFY_TOKEN_TTL_MS } from '../token/token.constants.js';
import { AuthMailerService } from './auth-mailer.service.js';

/**
 * Starts email verification for an address: issues a single-use
 * `email_verify` token and mails the link to it.
 *
 * Registration, admin email changes, restores with a replacement email and
 * the email-change flow all have the same primitive — "send the verification
 * link to this address" — so it lives in exactly one place.
 */
@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly authTokens: AuthTokenService,
    private readonly mailer: AuthMailerService,
  ) {}

  /**
   * Issues a verification token and sends the link.
   *
   * @param userId - Account the new address belongs to.
   * @param email - Address to verify (the account's current email after the
   * change has been applied).
   */
  async sendVerificationTo(userId: string, email: string): Promise<void> {
    const token = await this.authTokens.issue(
      userId,
      'email_verify',
      EMAIL_VERIFY_TOKEN_TTL_MS,
    );
    await this.mailer.sendVerifyEmail(email, token);
  }
}
