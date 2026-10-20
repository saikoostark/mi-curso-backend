import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityModule } from '../../identity/identity.module.js';
import { UserProfile } from '../../identity/users/user-profile.entity.js';
import { User } from '../../identity/users/user.entity.js';
import { AdminUserProfilesService } from './admin-user-profiles.service.js';
import { AdminUsersReadService } from './admin-users-read.service.js';
import { AdminUsersService } from './admin-users.service.js';
import { UsersController } from './users.controller.js';
import {
  CanAssignUserAttributes,
  CanCreateUsers,
  CanDeleteUsers,
  CanReadUsers,
  CanUpdateUsers,
} from './users.guards.js';
import { SuperuserProtectionPolicy } from './users.policies.js';

/**
 * Administration of user accounts (`/users`): controller, use-case services,
 * capability guards and the superuser protection policy.
 *
 * Account administration (`AdminUsersService`) and profile administration
 * (`AdminUserProfilesService`) are separate services composed here; they share
 * the superuser policy and the `users:*` capabilities, so no extra attribute
 * keys are needed. `AdminUsersReadService` owns the projected list/detail
 * queries, which is why this module registers the user entities for its own
 * repository injection.
 *
 * Imports `IdentityModule` for the account/profile primitives, transactional
 * provisioning, password policy, the shared authorization engine and the JWT
 * guard.
 */
@Module({
  imports: [IdentityModule, TypeOrmModule.forFeature([User, UserProfile])],
  controllers: [UsersController],
  providers: [
    AdminUsersService,
    AdminUsersReadService,
    AdminUserProfilesService,
    CanAssignUserAttributes,
    CanCreateUsers,
    CanDeleteUsers,
    CanReadUsers,
    CanUpdateUsers,
    SuperuserProtectionPolicy,
  ],
})
export class AdminUsersModule {}
