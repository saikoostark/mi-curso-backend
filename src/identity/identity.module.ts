import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailModule } from '../email/email.module.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { Attribute } from './attributes/attribute.entity.js';
import { AttributesService } from './attributes/attributes.service.js';
import { UserAttribute } from './attributes/user-attribute.entity.js';
import { AccountController } from './auth/account/account.controller.js';
import { AccountDeletionService } from './auth/account/account-deletion.service.js';
import { AccountService } from './auth/account/account.service.js';
import { EmailChangeController } from './auth/account/email-change.controller.js';
import { EmailChangeService } from './auth/account/email-change.service.js';
import { EmailChangeRequest } from './auth/account/entities/email-change-request.entity.js';
import { AuthMailerService } from './auth/auth-mailer.service.js';
import { EmailVerificationService } from './auth/email-verification.service.js';
import { PasswordResetService } from './auth/password-reset.service.js';
import { PasswordUpdateService } from './auth/account/password-update.service.js';
import { RecoveryController } from './auth/recovery/recovery.controller.js';
import { RecoveryService } from './auth/recovery/recovery.service.js';
import { RegistrationController } from './auth/registration/registration.controller.js';
import { RegistrationService } from './auth/registration/registration.service.js';
import { SessionController } from './auth/session/session.controller.js';
import { SessionService } from './auth/session/session.service.js';
import { GroupAttribute } from './groups/group-attribute.entity.js';
import { GroupMember } from './groups/group-member.entity.js';
import { Group } from './groups/group.entity.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { OptionalJwtAuthGuard } from './guards/optional-jwt-auth.guard.js';
import { PasswordService } from './password/password.service.js';
import { AccessTokenService } from './token/access-token.service.js';
import { AuthTokenService } from './token/auth-token.service.js';
import { AuthToken } from './token/entities/auth-token.entity.js';
import { RefreshToken } from './token/entities/refresh-token.entity.js';
import { RefreshTokenService } from './token/refresh-token.service.js';
import { RevocationService } from './token/revocation.service.js';
import { TokenCleanupService } from './token/token-cleanup.service.js';
import { ACCESS_TOKEN_TTL_SECONDS } from './token/token.constants.js';
import { UserProfile } from './users/user-profile.entity.js';
import { UserProfilesService } from './users/user-profiles.service.js';
import { UserProvisioningService } from './users/user-provisioning.service.js';
import { User } from './users/user.entity.js';
import { UsersService } from './users/users.service.js';

/**
 * The identity domain module: authentication flows, user accounts/profiles and
 * the shared attribute/group authorization engine.
 *
 * Auth routes are grouped into four journey slices — `registration`,
 * `session`, `account`, `recovery` — each with its own controller and service
 * plus the shared mailer and password-update tail. Management (user/group
 * administration, capability guards, the catalog endpoint) lives in
 * `src/admin/`, which composes this module; the engine, entities, manifests
 * and guard bases stay here as the shared domain.
 *
 * Owns the `users`/`user_profiles` tables (account vs display data),
 * `auth_tokens` (verification/reset/approval links), `refresh_tokens`
 * (rotation ledger), `email_change_requests` (pending two-sided changes) and
 * `attributes`/`user_attributes`/`groups`/`group_attributes`/`user_groups`
 * (authorization). Rate limiting comes from `RateLimitModule`; cache access
 * from the global `CacheModule`; email delivery from `EmailModule`; the
 * attribute catalog is seeded by migrations generated from the tooling-only
 * registry.
 *
 * Exports the primitives the admin surface composes (users, provisioning,
 * passwords, attributes, account lifecycle and email flows) plus the guard and
 * token services the consuming controllers need.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      UserProfile,
      AuthToken,
      RefreshToken,
      EmailChangeRequest,
      Attribute,
      UserAttribute,
      Group,
      GroupAttribute,
      GroupMember,
    ]),
    EmailModule,
    RateLimitModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
      }),
    }),
  ],
  controllers: [
    AccountController,
    EmailChangeController,
    RecoveryController,
    RegistrationController,
    SessionController,
  ],
  providers: [
    AccessTokenService,
    AccountDeletionService,
    AccountService,
    AttributesService,
    AuthMailerService,
    AuthTokenService,
    EmailChangeService,
    EmailVerificationService,
    JwtAuthGuard,
    OptionalJwtAuthGuard,
    PasswordResetService,
    PasswordService,
    PasswordUpdateService,
    RecoveryService,
    RefreshTokenService,
    RegistrationService,
    RevocationService,
    SessionService,
    TokenCleanupService,
    UserProfilesService,
    UserProvisioningService,
    UsersService,
  ],
  exports: [
    UsersService,
    UserProfilesService,
    UserProvisioningService,
    PasswordService,
    AttributesService,
    // Account lifecycle and email primitives reused by the admin surface
    // (soft deletion, restore verification, admin email changes).
    AccountDeletionService,
    EmailChangeService,
    EmailVerificationService,
    PasswordResetService,
    RefreshTokenService,
    // Admin modules reuse `JwtAuthGuard` on their controllers; Nest resolves
    // enhancer dependencies in the consuming module, so the guard's own
    // dependencies must be part of the exported surface as well.
    JwtAuthGuard,
    AccessTokenService,
    AuthTokenService,
    RevocationService,
  ],
})
export class IdentityModule {}
