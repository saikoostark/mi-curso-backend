import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AttributesService } from '../../identity/attributes/attributes.service.js';
import { AccountDeletionService } from '../../identity/auth/account/account-deletion.service.js';
import { EmailChangeService } from '../../identity/auth/account/email-change.service.js';
import { EmailVerificationService } from '../../identity/auth/email-verification.service.js';
import { PasswordResetService } from '../../identity/auth/password-reset.service.js';
import type { AuthenticatedUser } from '../../identity/decorators/current-user.decorator.js';
import { PasswordService } from '../../identity/password/password.service.js';
import { AuthTokenService } from '../../identity/token/auth-token.service.js';
import { RefreshTokenService } from '../../identity/token/refresh-token.service.js';
import type { UpdateUserProfileChanges } from '../../identity/users/user-profiles.service.js';
import { UserProvisioningService } from '../../identity/users/user-provisioning.service.js';
import {
  restoreConflict,
  toUserConflict,
  userUniqueViolation,
} from '../../identity/users/user-conflict.util.js';
import type { UserUniqueField } from '../../identity/users/user-conflict.util.js';
import { toUserView, UserView } from '../../identity/users/user.view.js';
import { USER_ERRORS } from '../../identity/users/users.error-codes.js';
import { UsersService } from '../../identity/users/users.service.js';
import { AdminUserProfilesService } from './admin-user-profiles.service.js';
import type { AdminUserPage } from './admin-users-read.service.js';
import type { AdminUserListOptions } from './admin-users-read.service.js';
import { AdminUsersReadService } from './admin-users-read.service.js';
import type { RestoreUserDto } from './dto/restore-user.dto.js';
import { SuperuserProtectionPolicy } from './users.policies.js';
import { ADMIN_USER_ERRORS } from './users.error-codes.js';

/** Fields an admin supplies when creating a verified user. */
export interface CreateVerifiedUserInput {
  email: string;
  username: string;
  password: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
}

/**
 * Mutable account fields (identity columns of `users`).
 *
 * `undefined` leaves a field untouched; neither field can be cleared — they are
 * required columns.
 */
export interface UpdateAccountChanges {
  email?: string;
  username?: string;
}

/**
 * Administration use cases for user accounts (`/users`).
 *
 * Account and profile persist in separate tables and are handled by separate
 * services; this service composes them into the flat `UserView` the admin API
 * returns. Reads go through `AdminUsersReadService`, which joins both tables in
 * one projected query; writes stay split between `UsersService` (account) and
 * `AdminUserProfilesService` (profile). The single `PATCH /users/:id` contract
 * is split by the controller into `UpdateAccountChanges` (handled here) and
 * `UpdateUserProfileChanges` (delegated to `AdminUserProfilesService`).
 *
 * Guards decide eligibility from the request; state rules on the target account
 * (the superuser flag) are enforced here, after the target is loaded, and again
 * by the profile service.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly users: UsersService,
    private readonly adminProfiles: AdminUserProfilesService,
    private readonly reads: AdminUsersReadService,
    private readonly provisioning: UserProvisioningService,
    private readonly passwords: PasswordService,
    private readonly superuserProtection: SuperuserProtectionPolicy,
    private readonly attributes: AttributesService,
    private readonly deletion: AccountDeletionService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly emailVerification: EmailVerificationService,
    private readonly emailChanges: EmailChangeService,
    private readonly authTokens: AuthTokenService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  /**
   * Lists users page by page, newest first unless a whitelisted sort is asked
   * for, applying the optional search/verification/superuser filters.
   *
   * @param options - Paging, filters and sort options.
   * @returns The page of combined views and the total number of matches.
   */
  list(options: AdminUserListOptions): Promise<AdminUserPage> {
    return this.reads.list(options);
  }

  /**
   * Loads one account with its profile for the admin detail route.
   *
   * @param id - User id.
   * @param withDeleted - Include a soft-deleted account (restore forensics).
   * @returns The combined view.
   * @throws NotFoundException when no such user exists.
   */
  async detail(id: string, withDeleted = false): Promise<UserView> {
    const view = await this.reads.detail(id, withDeleted);
    if (!view) {
      throw new NotFoundException({
        code: USER_ERRORS.userNotFound,
        message: 'User not found.',
      });
    }

    return view;
  }

  /**
   * Creates a verified user: policy-checked, uniqueness-checked, hashed — the
   * same rules as registration, minus the email flow. The account and profile
   * rows are inserted in one transaction.
   *
   * @param input - Email, username and plain-text password plus profile fields.
   * @returns The combined view of the persisted (verified) user.
   * @throws BadRequestException when the password violates the policy.
   * @throws ConflictException when the email/username is taken.
   */
  async createVerified(input: CreateVerifiedUserInput): Promise<UserView> {
    this.passwords.assertValid(input.password, {
      email: input.email,
      username: input.username,
    });

    await this.assertEmailFree(input.email);
    await this.assertUsernameFree(input.username);

    const passwordHash = await this.passwords.hash(input.password);
    const { user, profile } = await this.provisioning.createVerified({
      email: input.email,
      username: input.username,
      passwordHash,
      profile: {
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
      },
    });

    return toUserView(user, profile);
  }

  /**
   * Applies account changes and delegates profile changes to the profile
   * service, enforcing uniqueness and superuser protection in the flow.
   *
   * Changing the email is an admin override of the two-sided flow: the new
   * address is stored immediately, but `emailVerifiedAt` is cleared — the user
   * still has to prove ownership through the standard verification link.
   * Sessions die with the old address (access and refresh tokens are revoked),
   * so a session authenticated under the old identity cannot survive the swap.
   *
   * @param actor - Authenticated caller (superuser targets are protected by
   * `SuperuserProtectionPolicy`).
   * @param id - User id.
   * @param accountChanges - Email/username changes (see `UpdateAccountChanges`).
   * @param profileChanges - Display-field changes (see `UpdateUserProfileChanges`).
   * @returns The combined view of the updated user.
   * @throws NotFoundException when no such user exists.
   * @throws ForbiddenException when a non-superuser targets a superuser.
   * @throws ConflictException when the new email/username is taken.
   */
  async updateProfile(
    actor: AuthenticatedUser,
    id: string,
    accountChanges: UpdateAccountChanges,
    profileChanges: UpdateUserProfileChanges,
  ): Promise<UserView> {
    const user = await this.users.getById(id);
    this.superuserProtection.assertCanModify(actor, user);

    let accountChanged = false;
    let emailChanged = false;

    if (
      accountChanges.email !== undefined &&
      accountChanges.email !== user.email
    ) {
      await this.assertEmailFree(accountChanges.email, id);
      user.email = accountChanges.email;
      user.emailVerifiedAt = null;
      accountChanged = true;
      emailChanged = true;
    }

    if (
      accountChanges.username !== undefined &&
      accountChanges.username !== user.username
    ) {
      await this.assertUsernameFree(accountChanges.username, id);
      user.username = accountChanges.username;
      accountChanged = true;
    }

    if (accountChanged) {
      try {
        await this.users.save(user);
      } catch (error) {
        throw toUserConflict(error) ?? error;
      }
    }

    const profile = hasProfileChanges(profileChanges)
      ? await this.adminProfiles.updateProfile(actor, user, profileChanges)
      : await this.adminProfiles.findProfile(id);

    if (emailChanged) {
      // A pending self-service change must not survive an admin override: its
      // approval link would otherwise undo this decision later.
      await this.emailChanges.purgeForUser(id);
      // Reset links sent to the old address die with that identity; otherwise
      // the previous mailbox could still take over the account.
      await this.authTokens.invalidatePending(id, 'password_reset');
      await this.refreshTokens.revokeAllForUser(id);
      await this.emailVerification.sendVerificationTo(id, user.email);
    }

    return toUserView(user, profile);
  }

  /**
   * Restores a soft-deleted account.
   *
   * Deleted accounts release their email/username (partial unique indexes), so
   * a new registration may have claimed them in the meantime. The stored
   * identifiers are restored when still free; otherwise the request fails with
   * `restore_conflict` and `meta.conflicts`, and the admin retries with
   * replacements — the database stays the final authority, so a concurrent
   * claim is caught by the unique indexes and reported the same way.
   *
   * If the email is replaced, its verification state is cleared and the
   * standard verification link is sent to the new address; an unchanged,
   * previously verified email stays verified.
   *
   * Every restore forces a password reset: the account is marked, the old
   * password is refused at login with `password_reset_required`, and a fresh
   * single-use reset link is mailed to the restored address.
   *
   * @param actor - Authenticated caller.
   * @param id - User id.
   * @param dto - Optional replacement email/username.
   * @returns The restored combined view.
   * @throws NotFoundException when no such account exists (deleted or not).
   * @throws ForbiddenException when a non-superuser targets a superuser.
   * @throws BadRequestException when the account is not deleted.
   * @throws ConflictException when identifiers collide with another account.
   */
  async restore(
    actor: AuthenticatedUser,
    id: string,
    dto: RestoreUserDto,
  ): Promise<UserView> {
    const user = await this.users.findByIdWithDeleted(id);
    if (!user) {
      throw new NotFoundException({
        code: USER_ERRORS.userNotFound,
        message: 'User not found.',
      });
    }

    this.superuserProtection.assertCanModify(actor, user);

    if (user.deletedAt === null) {
      throw new BadRequestException({
        code: ADMIN_USER_ERRORS.notDeleted,
        message: 'This user is not deleted.',
      });
    }

    const email = dto.email ?? user.email;
    const username = dto.username ?? user.username;

    const conflicts = await this.findRestoreConflicts(id, email, username);
    if (conflicts.length > 0) {
      throw restoreConflict(conflicts);
    }

    const emailChanged = email !== user.email;
    try {
      await this.users.restore(id, {
        email,
        username,
        emailVerifiedAt: emailChanged ? null : user.emailVerifiedAt,
        // The pre-deletion password must not become valid again on its own.
        passwordResetRequired: true,
      });
    } catch (error) {
      const field = userUniqueViolation(error);
      if (field) {
        throw restoreConflict([field]);
      }
      throw error;
    }

    if (emailChanged) {
      await this.emailVerification.sendVerificationTo(id, email);
    }

    // Always mail a fresh reset link: the account is restored but locked until
    // the owner proves control of the mailbox.
    await this.passwordReset.sendResetLink(id, email);

    const restored = await this.users.getById(id);
    const profile = await this.adminProfiles.findProfile(id);
    return toUserView(restored, profile);
  }

  /**
   * Soft-deletes a user: the account row survives for a later restore while
   * sessions and pending tokens are destroyed (`AccountDeletionService`).
   * Grants and group memberships are kept, so a restore brings them back.
   *
   * @param actor - Authenticated caller (superuser targets are protected by
   * `SuperuserProtectionPolicy`).
   * @param id - User id.
   * @throws NotFoundException when no such user exists.
   * @throws ForbiddenException when a non-superuser targets a superuser.
   */
  async remove(actor: AuthenticatedUser, id: string): Promise<void> {
    const user = await this.users.getById(id);
    this.superuserProtection.assertCanModify(actor, user);
    await this.deletion.softDelete(id);
  }

  /**
   * Grants an attribute directly on a user (idempotent; subset rule applies).
   *
   * @param actor - Authenticated caller.
   * @param id - Target user id.
   * @param key - Attribute key to grant.
   * @throws ForbiddenException when a non-superuser targets a superuser, or
   * the actor does not hold the key.
   */
  async grantAttribute(
    actor: AuthenticatedUser,
    id: string,
    key: string,
  ): Promise<void> {
    const target = await this.users.getById(id);
    this.superuserProtection.assertCanModify(actor, target);
    await this.attributes.grantToUser(actor.id, id, key);
  }

  /**
   * Revokes a direct grant from a user (idempotent).
   *
   * @param actor - Authenticated caller.
   * @param id - Target user id.
   * @param key - Attribute key to revoke.
   * @throws ForbiddenException when a non-superuser targets a superuser.
   */
  async revokeAttribute(
    actor: AuthenticatedUser,
    id: string,
    key: string,
  ): Promise<void> {
    const target = await this.users.getById(id);
    this.superuserProtection.assertCanModify(actor, target);
    await this.attributes.revokeFromUser(id, key);
  }

  /**
   * Collects the identifiers of a restore that an active account already owns.
   *
   * Only active holders conflict: soft-deleted accounts released their
   * identifiers, so `findByEmail`/`findByUsername` (which exclude them) are the
   * right authority here.
   *
   * @param id - Account being restored (its own rows never conflict).
   * @param email - Identifier the account would get.
   * @param username - Identifier the account would get.
   * @returns Conflicting fields, newest-check order: email then username.
   */
  private async findRestoreConflicts(
    id: string,
    email: string,
    username: string,
  ): Promise<UserUniqueField[]> {
    const conflicts: UserUniqueField[] = [];

    const emailOwner = await this.users.findByEmail(email);
    if (emailOwner && emailOwner.id !== id) {
      conflicts.push('email');
    }

    const usernameOwner = await this.users.findByUsername(username);
    if (usernameOwner && usernameOwner.id !== id) {
      conflicts.push('username');
    }

    return conflicts;
  }

  /**
   * Throws 409 when the email belongs to a different user.
   *
   * @param email - Normalized email address.
   * @param exceptUserId - User allowed to keep the address.
   */
  private async assertEmailFree(
    email: string,
    exceptUserId?: string,
  ): Promise<void> {
    const existing = await this.users.findByEmail(email);
    if (existing && existing.id !== exceptUserId) {
      throw new ConflictException({
        code: USER_ERRORS.emailTaken,
        message: 'This email is already registered.',
      });
    }
  }

  /**
   * Throws 409 when the username belongs to a different user.
   *
   * @param username - Normalized username.
   * @param exceptUserId - User allowed to keep the username.
   */
  private async assertUsernameFree(
    username: string,
    exceptUserId?: string,
  ): Promise<void> {
    const existing = await this.users.findByUsername(username);
    if (existing && existing.id !== exceptUserId) {
      throw new ConflictException({
        code: USER_ERRORS.usernameTaken,
        message: 'This username is already taken.',
      });
    }
  }
}

/** Whether the payload carries at least one profile field to write. */
function hasProfileChanges(changes: UpdateUserProfileChanges): boolean {
  return (
    changes.firstName !== undefined ||
    changes.lastName !== undefined ||
    changes.phone !== undefined
  );
}
