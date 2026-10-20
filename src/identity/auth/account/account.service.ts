import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PasswordService } from '../../password/password.service.js';
import { TOKEN_ERRORS } from '../../token/token.error-codes.js';
import { UserProfilesService } from '../../users/user-profiles.service.js';
import { toUserView, UserView } from '../../users/user.view.js';
import { UsersService } from '../../users/users.service.js';
import { AUTH_ERRORS } from '../auth.error-codes.js';
import { AccountDeletionService } from './account-deletion.service.js';
import { PasswordUpdateService } from './password-update.service.js';
import type { ChangePasswordDto } from './dto/change-password.dto.js';
import type { DeleteAccountDto } from './dto/delete-account.dto.js';
import type { UpdateOwnProfileDto } from './dto/update-own-profile.dto.js';

/**
 * The account journey for the authenticated caller: read the own account with
 * its profile and change the own password.
 *
 * Password changes require the current password, then revoke every session
 * (including the current one) — the user logs in again on all devices.
 */
@Injectable()
export class AccountService {
  constructor(
    private readonly users: UsersService,
    private readonly profiles: UserProfilesService,
    private readonly passwords: PasswordService,
    private readonly passwordUpdate: PasswordUpdateService,
    private readonly deletion: AccountDeletionService,
  ) {}

  /**
   * Returns the authenticated user's account with the profile flattened in.
   *
   * @param userId - Authenticated user.
   * @returns Combined user view.
   * @throws UnauthorizedException when the account no longer exists.
   */
  async me(userId: string): Promise<UserView> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedException({
        code: TOKEN_ERRORS.invalidToken,
        message: 'Invalid or expired token.',
      });
    }

    const profile = await this.profiles.findByUserId(userId);
    return toUserView(user, profile);
  }

  /**
   * Updates the authenticated user's own profile (display fields only).
   *
   * @param userId - Authenticated user.
   * @param dto - Fields to change; omitted keys stay untouched and `null`
   * clears a field.
   * @returns The updated combined user view.
   * @throws UnauthorizedException when the account no longer exists.
   * @throws NotFoundException when the profile row is missing (invariant).
   */
  async updateProfile(
    userId: string,
    dto: UpdateOwnProfileDto,
  ): Promise<UserView> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedException({
        code: TOKEN_ERRORS.invalidToken,
        message: 'Invalid or expired token.',
      });
    }

    const profile = await this.profiles.update(userId, {
      firstName: dto.firstName,
      lastName: dto.lastName,
      phone: dto.phone,
    });

    return toUserView(user, profile);
  }

  /**
   * Soft-deletes the authenticated user's own account.
   *
   * The password is re-checked (a stolen access token alone must not be enough
   * to destroy the account) and `confirm` must be true. Deletion is soft so an
   * admin can restore it; sessions and pending tokens are destroyed
   * immediately.
   *
   * @param userId - Authenticated user.
   * @param dto - Password plus the explicit confirmation flag.
   * @returns Success message.
   * @throws UnauthorizedException when the account no longer exists.
   * @throws BadRequestException when the password is wrong or unconfirmed.
   */
  async deleteAccount(
    userId: string,
    dto: DeleteAccountDto,
  ): Promise<{ message: string }> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedException({
        code: TOKEN_ERRORS.invalidToken,
        message: 'Invalid or expired token.',
      });
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

    await this.deletion.softDelete(userId);
    return { message: 'Account deleted.' };
  }

  /**
   * Changes the password while logged in.
   *
   * @param userId - Authenticated user.
   * @param dto - Current password plus the new one (with confirmation).
   * @returns Success message.
   * @throws UnauthorizedException when the account no longer exists.
   * @throws BadRequestException when the current password is wrong or the new
   * one violates the policy.
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedException({
        code: TOKEN_ERRORS.invalidToken,
        message: 'Invalid or expired token.',
      });
    }

    const currentValid = await this.passwords.verify(
      dto.currentPassword,
      user.passwordHash,
    );
    if (!currentValid) {
      throw new BadRequestException({
        code: AUTH_ERRORS.invalidCurrentPassword,
        message: 'Current password is incorrect.',
      });
    }

    await this.passwordUpdate.updatePassword(
      user,
      dto.newPassword,
      dto.passwordConfirm,
    );

    return {
      message: 'Password changed. Please log in again on all devices.',
    };
  }
}
