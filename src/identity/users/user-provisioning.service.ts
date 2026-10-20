import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { UserProfile } from './user-profile.entity.js';
import type { UserProfileFields } from './user-profiles.service.js';
import { UserProfilesService } from './user-profiles.service.js';
import { toUserConflict } from './user-conflict.util.js';
import type { User } from './user.entity.js';
import { UsersService } from './users.service.js';

/** Input for a regular, unverified registration. */
export interface CreateUnverifiedUserInput {
  email: string;
  username: string;
  passwordHash: string;
  profile: UserProfileFields;
}

/** Input for an admin-created verified account. */
export interface CreateVerifiedUserRecordInput {
  email: string;
  username: string;
  passwordHash: string;
  profile: UserProfileFields;
}

/** Input for the CLI-created superuser bootstrap. */
export interface CreateSuperuserRecordInput {
  email: string;
  username: string;
  passwordHash: string;
}

/** Fully-resolved fields for the transactional creation primitive. */
export interface ProvisionUserInput {
  email: string;
  username: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
  isSuperuser: boolean;
  profile: UserProfileFields;
}

/** An account and its profile, created as one unit. */
export interface ProvisionedUser {
  user: User;
  profile: UserProfile;
}

/**
 * Creates a user account together with its profile row.
 *
 * This is the only supported account-creation path: `users` and `user_profiles`
 * are separate tables, but an account without a profile would be an invalid
 * state. The two inserts share one database transaction, so a failure on either
 * side leaves no half-created account behind.
 */
@Injectable()
export class UserProvisioningService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly users: UsersService,
    private readonly profiles: UserProfilesService,
  ) {}

  /**
   * Creates an unverified, non-superuser account (registration).
   *
   * @param input - Account identifiers, password hash and profile fields.
   * @returns The account and its profile.
   */
  createUnverified(input: CreateUnverifiedUserInput): Promise<ProvisionedUser> {
    return this.create({
      ...input,
      emailVerifiedAt: null,
      isSuperuser: false,
    });
  }

  /**
   * Creates a verified, non-superuser account (admin creation).
   *
   * @param input - Account identifiers, password hash and profile fields.
   * @returns The account and its profile.
   */
  createVerified(
    input: CreateVerifiedUserRecordInput,
  ): Promise<ProvisionedUser> {
    return this.create({
      ...input,
      emailVerifiedAt: new Date(),
      isSuperuser: false,
    });
  }

  /**
   * Creates a verified superuser with an empty profile (CLI bootstrap).
   *
   * @param input - Account identifiers and password hash.
   * @returns The account and its profile.
   */
  createSuperuser(input: CreateSuperuserRecordInput): Promise<ProvisionedUser> {
    return this.create({
      ...input,
      emailVerifiedAt: new Date(),
      isSuperuser: true,
      profile: { firstName: null, lastName: null, phone: null },
    });
  }

  /**
   * Runs both inserts in a single transaction.
   *
   * A unique violation on `email`/`username` means a concurrent registration
   * won the race after the caller's pre-check; it is translated into the same
   * 409 the pre-check raises instead of surfacing as a generic 500.
   *
   * @param input - Fully-resolved account and profile fields.
   * @returns The persisted account and profile.
   * @throws ConflictException when another account owns the email/username.
   */
  private async create(input: ProvisionUserInput): Promise<ProvisionedUser> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const user = await this.users.createRecord(
          {
            email: input.email,
            username: input.username,
            passwordHash: input.passwordHash,
            emailVerifiedAt: input.emailVerifiedAt,
            isSuperuser: input.isSuperuser,
          },
          manager,
        );

        const profile = await this.profiles.create(
          { userId: user.id, ...input.profile },
          manager,
        );

        return { user, profile };
      });
    } catch (error) {
      throw toUserConflict(error) ?? error;
    }
  }
}
