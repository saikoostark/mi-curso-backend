import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../identity/decorators/current-user.decorator.js';
import type { UserProfile } from '../../identity/users/user-profile.entity.js';
import type { UpdateUserProfileChanges } from '../../identity/users/user-profiles.service.js';
import { UserProfilesService } from '../../identity/users/user-profiles.service.js';
import type { User } from '../../identity/users/user.entity.js';
import { SuperuserProtectionPolicy } from './users.policies.js';

/**
 * Administration use cases for user profiles (`user_profiles`).
 *
 * Account administration (`AdminUsersService`) and profile administration are
 * separate services even though the HTTP contract keeps a single
 * `PATCH /users/:id` payload: the controller splits the fields, `AdminUsersService`
 * applies the account changes and delegates the profile fields here.
 *
 * State-dependent rules are enforced in the flow: the target account is loaded
 * by the caller, so this service re-checks `SuperuserProtectionPolicy` before
 * writing — a non-superuser must not edit a superuser's profile either.
 */
@Injectable()
export class AdminUserProfilesService {
  constructor(
    private readonly profiles: UserProfilesService,
    private readonly superuserProtection: SuperuserProtectionPolicy,
  ) {}

  /**
   * Loads a user's profile for an admin read.
   *
   * @param userId - Target account id.
   * @returns The profile or `null` when the row is missing (invariant breach).
   */
  findProfile(userId: string): Promise<UserProfile | null> {
    return this.profiles.findByUserId(userId);
  }

  /**
   * Updates the display fields of an already-loaded account.
   *
   * @param actor - Authenticated caller.
   * @param target - Target account, loaded by the calling flow.
   * @param changes - Profile fields to change (`undefined` keeps the current value).
   * @returns The updated profile.
   * @throws ForbiddenException when a non-superuser targets a superuser.
   * @throws NotFoundException when the profile row is missing.
   */
  async updateProfile(
    actor: AuthenticatedUser,
    target: User,
    changes: UpdateUserProfileChanges,
  ): Promise<UserProfile> {
    this.superuserProtection.assertCanModify(actor, target);
    return this.profiles.update(target.id, changes);
  }
}
