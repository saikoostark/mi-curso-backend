import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../../email/email.service.js';

/**
 * Builds and sends the auth emails: verification, password reset and the
 * old-address approval link of an email change.
 *
 * Link templates live here so the flow services stay focused on state
 * transitions; delivery itself goes through the `EmailService` port (file
 * outbox in development).
 */
@Injectable()
export class AuthMailerService {
  constructor(
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Emails the verification link.
   *
   * @param to - Recipient email address.
   * @param token - Raw email-verify token.
   */
  async sendVerifyEmail(to: string, token: string): Promise<void> {
    const link = `${this.appUrl()}/auth/verify-email?token=${encodeURIComponent(token)}`;
    await this.email.send({
      to,
      subject: 'Verify your email',
      text: [
        'Welcome to MiCurso!',
        '',
        'Verify your email by opening this link:',
        link,
        '',
        'If you did not create an account, you can safely ignore this email.',
      ].join('\n'),
    });
  }

  /**
   * Emails the password-reset link.
   *
   * @param to - Recipient email address.
   * @param token - Raw password-reset token.
   */
  async sendResetEmail(to: string, token: string): Promise<void> {
    const link = `${this.appUrl()}/auth/reset-password?token=${encodeURIComponent(token)}`;
    await this.email.send({
      to,
      subject: 'Reset your password',
      text: [
        'We received a request to reset your MiCurso password.',
        '',
        'Open this link to choose a new password:',
        link,
        '',
        `Token: ${token}`,
        '',
        'The link expires in 1 hour. If you did not request this, you can ignore this email.',
      ].join('\n'),
    });
  }

  /**
   * Emails the old-address approval link of a two-sided email change.
   *
   * Sent to the **current** address on purpose: whoever controls the account
   * must consent before the identity moves. The new address receives nothing
   * until the change is applied (then the standard verification link follows).
   *
   * @param to - Current (old) email address.
   * @param newEmail - Address the account will switch to.
   * @param token - Raw `email_change_old` token.
   */
  async sendEmailChangeApproval(
    to: string,
    newEmail: string,
    token: string,
  ): Promise<void> {
    const link = `${this.appUrl()}/auth/email/approve?token=${encodeURIComponent(token)}`;
    await this.email.send({
      to,
      subject: 'Approve your email change',
      text: [
        'We received a request to change the email address on your MiCurso account.',
        '',
        `New address: ${newEmail}`,
        '',
        'Approve the change by opening this link:',
        link,
        '',
        'The link expires in 1 hour. If you did not request this, you can ignore this email — the address stays unchanged.',
      ].join('\n'),
    });
  }

  /** Base URL for links inside emails. */
  private appUrl(): string {
    return this.config.get<string>('APP_URL') ?? 'http://localhost:3000';
  }
}
