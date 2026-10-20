import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager } from 'typeorm';
import { Repository } from 'typeorm';
import { UserProfile } from './user-profile.entity.js';
import { USER_ERRORS } from './users.error-codes.js';

/** Display fields shared by profile creation and updates. */
export interface UserProfileFields {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
}

/** Fields required to create the profile row of an account. */
export interface CreateUserProfileInput extends UserProfileFields {
  userId: string;
}

/**
 * Mutable profile fields.
 *
 * `undefined` leaves a field untouched; `null` clears it. All three fields are
 * nullable columns, so clearing is always valid.
 */
export interface UpdateUserProfileChanges {
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
}

/**
 * Owns persistence access to the `user_profiles` table.
 *
 * Profiles are separate 1:1 records, not a JSON column on `users`: account
 * credentials/state and display data have different lifecycles and different
 * access surfaces. The repository is only touched here; the auth flows read
 * through this service and administration goes through
 * `AdminUserProfilesService`.
 */
@Injectable()
export class UserProfilesService {
  constructor(
    @InjectRepository(UserProfile)
    private readonly repository: Repository<UserProfile>,
  ) {}

  /**
   * Persists the profile row of a new account.
   *
   * @param input - Owner id plus the initial (possibly all-null) fields.
   * @param manager - Optional transaction manager used by provisioning.
   * @returns The persisted profile.
   */
  create(
    input: CreateUserProfileInput,
    manager?: EntityManager,
  ): Promise<UserProfile> {
    const repository = manager?.getRepository(UserProfile) ?? this.repository;
    return repository.save(repository.create(input));
  }

  /**
   * Finds the profile of a user.
   *
   * @param userId - Owner account id.
   * @returns The profile or `null` when it does not exist.
   */
  findByUserId(userId: string): Promise<UserProfile | null> {
    return this.repository.findOne({ where: { userId } });
  }

  /**
   * Loads a profile or fails.
   *
   * @param userId - Owner account id.
   * @returns The profile.
   * @throws NotFoundException when the profile row is missing.
   */
  async getByUserId(userId: string): Promise<UserProfile> {
    const profile = await this.findByUserId(userId);
    if (!profile) {
      throw new NotFoundException({
        code: USER_ERRORS.userProfileNotFound,
        message: 'User profile not found.',
      });
    }

    return profile;
  }

  /**
   * Applies partial changes to an existing profile.
   *
   * @param userId - Owner account id.
   * @param changes - Fields to change; `undefined` keeps the current value.
   * @returns The updated profile.
   * @throws NotFoundException when the profile row is missing.
   */
  async update(
    userId: string,
    changes: UpdateUserProfileChanges,
  ): Promise<UserProfile> {
    const profile = await this.getByUserId(userId);

    if (changes.firstName !== undefined) {
      profile.firstName = changes.firstName;
    }
    if (changes.lastName !== undefined) {
      profile.lastName = changes.lastName;
    }
    if (changes.phone !== undefined) {
      profile.phone = changes.phone;
    }

    return this.repository.save(profile);
  }
}
