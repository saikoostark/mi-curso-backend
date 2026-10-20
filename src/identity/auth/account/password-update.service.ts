import { Injectable } from '@nestjs/common';
import { PasswordService } from '../../password/password.service.js';
import { AuthTokenService } from '../../token/auth-token.service.js';
import { RefreshTokenService } from '../../token/refresh-token.service.js';
import type { User } from '../../users/user.entity.js';
import { UsersService } from '../../users/users.service.js';
import { EmailChangeService } from './email-change.service.js';

/**
 * The account-owned password-update tail, reused by the recovery flow.
 *
 * Changing a password is an account-management operation, so the rules live
 * with `account`; `recovery` reuses the same tail for the emailed reset link.
 * It validates the confirmation and the policy against the account's own
 * identifiers, stores the new hash and revokes every session: all devices
 * must log in again. Invalidation of pending reset links is part of the tail,
 * so an old link cannot undo a fresh change; a pending email change is
 * cancelled for the same reason (its approval link must not outlive the
 * credentials it was requested with).
 */
@Injectable()
export class PasswordUpdateService {
  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly authTokens: AuthTokenService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly emailChanges: EmailChangeService,
  ) {}

  /**
   * Validates, stores and revokes — the whole password-update tail.
   *
   * @param user - Target account, already loaded by the calling flow.
   * @param newPassword - New password.
   * @param passwordConfirm - Confirmation of the new password.
   * @throws BadRequestException when the confirmation or the policy fails.
   */
  async updatePassword(
    user: User,
    newPassword: string,
    passwordConfirm: string,
  ): Promise<void> {
    this.passwords.assertMatch(newPassword, passwordConfirm);
    this.passwords.assertValid(newPassword, {
      email: user.email,
      username: user.username,
    });

    await this.users.updatePasswordHash(
      user.id,
      await this.passwords.hash(newPassword),
    );
    await this.authTokens.invalidatePending(user.id, 'password_reset');
    await this.emailChanges.purgeForUser(user.id);
    await this.refreshTokens.revokeAllForUser(user.id);
  }
}
