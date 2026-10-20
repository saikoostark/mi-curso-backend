import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AttributesService } from '../../identity/attributes/attributes.service.js';
import type { AccountDeletionService } from '../../identity/auth/account/account-deletion.service.js';
import type { EmailChangeService } from '../../identity/auth/account/email-change.service.js';
import type { EmailVerificationService } from '../../identity/auth/email-verification.service.js';
import type { PasswordResetService } from '../../identity/auth/password-reset.service.js';
import type { AuthenticatedUser } from '../../identity/decorators/current-user.decorator.js';
import { PASSWORD_ERRORS } from '../../identity/password/password.error-codes.js';
import { PasswordService } from '../../identity/password/password.service.js';
import type { AuthTokenService } from '../../identity/token/auth-token.service.js';
import type { RefreshTokenService } from '../../identity/token/refresh-token.service.js';
import type { UserProfile } from '../../identity/users/user-profile.entity.js';
import type { UserProvisioningService } from '../../identity/users/user-provisioning.service.js';
import type { User } from '../../identity/users/user.entity.js';
import { USER_ERRORS } from '../../identity/users/users.error-codes.js';
import type { UsersService } from '../../identity/users/users.service.js';
import { AdminUserProfilesService } from './admin-user-profiles.service.js';
import type { AdminUsersReadService } from './admin-users-read.service.js';
import { AdminUsersService } from './admin-users.service.js';
import { SuperuserProtectionPolicy } from './users.policies.js';
import { ADMIN_USER_ERRORS } from './users.error-codes.js';

/** User entity factory for test data. */
function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'jane@example.com',
    username: 'janedoe',
    passwordHash: 'stored-hash',
    emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    isSuperuser: false,
    passwordResetRequired: false,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

/** Profile entity factory for test data. */
function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    userId: 'user-1',
    firstName: 'Jane',
    lastName: 'Doe',
    phone: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as UserProfile;
}

/** Actor factory for test data. */
function makeActor(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'admin-1',
    isSuperuser: false,
    jti: 'test-jti',
    accessExpiresAtMs: Date.now() + 900_000,
    ...overrides,
  };
}

/** Runs the call and returns the HTTP error, failing when it resolves. */
async function httpError(run: () => Promise<unknown>): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  try {
    await run();
  } catch (error) {
    const status =
      error instanceof BadRequestException
        ? 400
        : error instanceof ForbiddenException
          ? 403
          : error instanceof ConflictException
            ? 409
            : error instanceof NotFoundException
              ? 404
              : -1;
    return {
      status,
      body: (error as { getResponse(): Record<string, unknown> }).getResponse(),
    };
  }

  throw new Error('Expected an HttpException');
}

describe('AdminUsersService', () => {
  let users: ReturnType<typeof createUsersMock>;
  let adminProfiles: ReturnType<typeof createAdminProfilesMock>;
  let reads: ReturnType<typeof createReadsMock>;
  let provisioning: ReturnType<typeof createProvisioningMock>;
  let passwords: PasswordService;
  let attributes: ReturnType<typeof createAttributesMock>;
  let deletion: ReturnType<typeof createDeletionMock>;
  let refreshTokens: ReturnType<typeof createRefreshTokensMock>;
  let emailVerification: ReturnType<typeof createEmailVerificationMock>;
  let emailChanges: ReturnType<typeof createEmailChangesMock>;
  let authTokens: ReturnType<typeof createAuthTokensMock>;
  let passwordReset: ReturnType<typeof createPasswordResetMock>;
  let actor: AuthenticatedUser;
  let service: AdminUsersService;

  beforeEach(() => {
    users = createUsersMock();
    adminProfiles = createAdminProfilesMock();
    reads = createReadsMock();
    provisioning = createProvisioningMock();
    passwords = new PasswordService();
    vi.spyOn(passwords, 'hash').mockResolvedValue('fresh-hash');
    attributes = createAttributesMock();
    deletion = createDeletionMock();
    refreshTokens = createRefreshTokensMock();
    emailVerification = createEmailVerificationMock();
    emailChanges = createEmailChangesMock();
    authTokens = createAuthTokensMock();
    passwordReset = createPasswordResetMock();
    actor = makeActor();

    service = new AdminUsersService(
      users as unknown as UsersService,
      adminProfiles as unknown as AdminUserProfilesService,
      reads as unknown as AdminUsersReadService,
      provisioning as unknown as UserProvisioningService,
      passwords,
      new SuperuserProtectionPolicy(),
      attributes as unknown as AttributesService,
      deletion as unknown as AccountDeletionService,
      refreshTokens as unknown as RefreshTokenService,
      emailVerification as unknown as EmailVerificationService,
      emailChanges as unknown as EmailChangeService,
      authTokens as unknown as AuthTokenService,
      passwordReset as unknown as PasswordResetService,
    );
  });

  describe('createVerified', () => {
    it('policy-checks, hashes and stores a verified account with its profile', async () => {
      const validatePolicy = vi.spyOn(passwords, 'validatePolicy');
      users.findByEmail.mockResolvedValue(null);
      users.findByUsername.mockResolvedValue(null);
      provisioning.createVerified.mockResolvedValue({
        user: makeUser({
          id: 'user-2',
          email: 'new@example.com',
          username: 'newbie',
        }),
        profile: makeProfile({ userId: 'user-2', firstName: 'New' }),
      });

      const view = await service.createVerified({
        email: 'new@example.com',
        username: 'newbie',
        password: 'Sup3rSecret!',
        firstName: 'New',
        lastName: null,
        phone: null,
      });

      expect(validatePolicy).toHaveBeenCalledWith('Sup3rSecret!', {
        email: 'new@example.com',
        username: 'newbie',
      });
      expect(provisioning.createVerified).toHaveBeenCalledWith({
        email: 'new@example.com',
        username: 'newbie',
        passwordHash: 'fresh-hash',
        profile: { firstName: 'New', lastName: null, phone: null },
      });
      expect(view).toMatchObject({
        email: 'new@example.com',
        username: 'newbie',
        firstName: 'New',
        emailVerified: true,
      });
    });

    it('rejects passwords that violate the policy', async () => {
      vi.spyOn(passwords, 'validatePolicy').mockReturnValue(['too short']);

      const error = await httpError(() =>
        service.createVerified({
          email: 'new@example.com',
          username: 'newbie',
          password: 'weak',
          firstName: null,
          lastName: null,
          phone: null,
        }),
      );

      expect(error.status).toBe(400);
      expect(error.body.code).toBe(PASSWORD_ERRORS.passwordPolicy);
      expect(provisioning.createVerified).not.toHaveBeenCalled();
    });

    it('rejects a taken email', async () => {
      users.findByEmail.mockResolvedValue(makeUser({ id: 'someone-else' }));

      const error = await httpError(() =>
        service.createVerified({
          email: 'jane@example.com',
          username: 'newbie',
          password: 'Sup3rSecret!',
          firstName: null,
          lastName: null,
          phone: null,
        }),
      );

      expect(error.status).toBe(409);
      expect(error.body.code).toBe(USER_ERRORS.emailTaken);
    });

    it('rejects a taken username', async () => {
      users.findByEmail.mockResolvedValue(null);
      users.findByUsername.mockResolvedValue(makeUser({ id: 'someone-else' }));

      const error = await httpError(() =>
        service.createVerified({
          email: 'new@example.com',
          username: 'janedoe',
          password: 'Sup3rSecret!',
          firstName: null,
          lastName: null,
          phone: null,
        }),
      );

      expect(error.status).toBe(409);
      expect(error.body.code).toBe(USER_ERRORS.usernameTaken);
    });
  });

  describe('detail', () => {
    it('reads the combined view through the projected query', async () => {
      reads.detail.mockResolvedValue({
        id: 'user-1',
        email: 'jane@example.com',
        username: 'janedoe',
        firstName: 'Jane',
        lastName: 'Doe',
        phone: null,
        isSuperuser: false,
        emailVerified: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      });

      const view = await service.detail('user-1');

      expect(reads.detail).toHaveBeenCalledWith('user-1', false);
      expect(view).toMatchObject({
        id: 'user-1',
        email: 'jane@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
      });
    });

    it('can include a soft-deleted account on request', async () => {
      reads.detail.mockResolvedValue({
        id: 'user-1',
        email: 'jane@example.com',
        username: 'janedoe',
        firstName: 'Jane',
        lastName: 'Doe',
        phone: null,
        isSuperuser: false,
        emailVerified: true,
        deletedAt: '2026-02-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
      });

      const view = await service.detail('user-1', true);

      expect(reads.detail).toHaveBeenCalledWith('user-1', true);
      expect(view.deletedAt).toBe('2026-02-01T00:00:00.000Z');
    });

    it('fails loudly when the projected read finds nothing', async () => {
      reads.detail.mockResolvedValue(null);

      const error = await httpError(() => service.detail('missing'));

      expect(error.status).toBe(404);
      expect(error.body.code).toBe(USER_ERRORS.userNotFound);
    });
  });

  describe('updateProfile', () => {
    it('fails for unknown users', async () => {
      users.getById.mockRejectedValue(
        new NotFoundException({ code: USER_ERRORS.userNotFound }),
      );

      const error = await httpError(() =>
        service.updateProfile(actor, 'missing', { email: undefined }, {}),
      );

      expect(error.status).toBe(404);
      expect(error.body.code).toBe(USER_ERRORS.userNotFound);
    });

    it('updates account fields and restarts verification when the email changes', async () => {
      const user = makeUser();
      users.getById.mockResolvedValue(user);
      users.findByEmail.mockResolvedValue(null);
      users.findByUsername.mockResolvedValue(null);
      adminProfiles.findProfile.mockResolvedValue(makeProfile());

      const view = await service.updateProfile(
        actor,
        'user-1',
        { email: 'janet@example.com', username: 'janet' },
        { firstName: undefined, lastName: undefined, phone: undefined },
      );

      expect(user.email).toBe('janet@example.com');
      expect(user.username).toBe('janet');
      expect(user.emailVerifiedAt).toBeNull();
      expect(users.save).toHaveBeenCalledWith(user);
      expect(adminProfiles.updateProfile).not.toHaveBeenCalled();
      // Sessions die with the old address and the new one must be verified.
      expect(emailChanges.purgeForUser).toHaveBeenCalledWith('user-1');
      expect(authTokens.invalidatePending).toHaveBeenCalledWith(
        'user-1',
        'password_reset',
      );
      expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith('user-1');
      expect(emailVerification.sendVerificationTo).toHaveBeenCalledWith(
        'user-1',
        'janet@example.com',
      );
      expect(view).toMatchObject({
        email: 'janet@example.com',
        username: 'janet',
        firstName: 'Jane',
        emailVerified: false,
      });
    });

    it('leaves untouched fields alone and skips the save when nothing changed', async () => {
      const user = makeUser();
      users.getById.mockResolvedValue(user);
      adminProfiles.findProfile.mockResolvedValue(makeProfile());

      await service.updateProfile(actor, 'user-1', {}, {});

      expect(users.save).not.toHaveBeenCalled();
      expect(refreshTokens.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('treats unchanged identifiers as a no-op without a save', async () => {
      const user = makeUser();
      users.getById.mockResolvedValue(user);
      adminProfiles.findProfile.mockResolvedValue(makeProfile());

      await service.updateProfile(
        actor,
        'user-1',
        { email: 'jane@example.com', username: 'janedoe' },
        {},
      );

      expect(users.findByEmail).not.toHaveBeenCalled();
      expect(users.save).not.toHaveBeenCalled();
      expect(refreshTokens.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('delegates profile fields to the admin profile service', async () => {
      const user = makeUser();
      users.getById.mockResolvedValue(user);
      adminProfiles.updateProfile.mockResolvedValue(
        makeProfile({ firstName: 'Janet', phone: '+4915112345678' }),
      );

      const view = await service.updateProfile(
        actor,
        'user-1',
        { email: undefined, username: undefined },
        { firstName: 'Janet', phone: '+4915112345678' },
      );

      expect(users.save).not.toHaveBeenCalled();
      expect(adminProfiles.updateProfile).toHaveBeenCalledWith(actor, user, {
        firstName: 'Janet',
        phone: '+4915112345678',
      });
      expect(view).toMatchObject({
        firstName: 'Janet',
        phone: '+4915112345678',
        email: 'jane@example.com',
      });
    });

    it('clears nullable profile fields on explicit null', async () => {
      const user = makeUser();
      users.getById.mockResolvedValue(user);
      adminProfiles.updateProfile.mockResolvedValue(
        makeProfile({ phone: null }),
      );

      await service.updateProfile(actor, 'user-1', {}, { phone: null });

      expect(adminProfiles.updateProfile).toHaveBeenCalledWith(actor, user, {
        phone: null,
      });
    });

    it("allows keeping the own email but rejects another user's", async () => {
      const user = makeUser();
      users.getById.mockResolvedValue(user);
      adminProfiles.findProfile.mockResolvedValue(makeProfile());

      // Keeping the own email is a no-op (no uniqueness lookup, no save).
      await expect(
        service.updateProfile(
          actor,
          'user-1',
          { email: 'jane@example.com' },
          {},
        ),
      ).resolves.toBeDefined();
      expect(users.findByEmail).not.toHaveBeenCalled();

      users.findByEmail.mockResolvedValue(makeUser({ id: 'someone-else' }));

      const error = await httpError(() =>
        service.updateProfile(
          actor,
          'user-1',
          { email: 'claimed@example.com' },
          {},
        ),
      );
      expect(error.status).toBe(409);
      expect(error.body.code).toBe(USER_ERRORS.emailTaken);
    });

    it('rejects switching to a taken username', async () => {
      users.getById.mockResolvedValue(makeUser());
      users.findByUsername.mockResolvedValue(makeUser({ id: 'someone-else' }));

      const error = await httpError(() =>
        service.updateProfile(actor, 'user-1', { username: 'janet' }, {}),
      );

      expect(error.status).toBe(409);
      expect(error.body.code).toBe(USER_ERRORS.usernameTaken);
    });

    it('blocks a non-superuser from updating a superuser', async () => {
      users.getById.mockResolvedValue(makeUser({ isSuperuser: true }));

      const error = await httpError(() =>
        service.updateProfile(
          actor,
          'user-1',
          { email: undefined, username: undefined },
          { firstName: 'Hacked' },
        ),
      );

      expect(error.status).toBe(403);
      expect(error.body.code).toBe(ADMIN_USER_ERRORS.superuserProtected);
      expect(users.save).not.toHaveBeenCalled();
      expect(adminProfiles.updateProfile).not.toHaveBeenCalled();
    });

    it('lets a superuser update another superuser', async () => {
      const user = makeUser({ isSuperuser: true });
      users.getById.mockResolvedValue(user);
      adminProfiles.updateProfile.mockResolvedValue(
        makeProfile({ firstName: 'Root' }),
      );

      await service.updateProfile(
        makeActor({ isSuperuser: true }),
        'user-1',
        {},
        { firstName: 'Root' },
      );

      expect(adminProfiles.updateProfile).toHaveBeenCalledWith(
        expect.objectContaining({ isSuperuser: true }),
        user,
        { firstName: 'Root' },
      );
    });
  });

  describe('remove', () => {
    it('soft-deletes through the deletion service', async () => {
      users.getById.mockResolvedValue(makeUser());

      await service.remove(actor, 'user-1');

      expect(deletion.softDelete).toHaveBeenCalledWith('user-1');
    });

    it('fails for unknown users', async () => {
      users.getById.mockRejectedValue(
        new NotFoundException({ code: USER_ERRORS.userNotFound }),
      );

      const error = await httpError(() => service.remove(actor, 'missing'));

      expect(error.status).toBe(404);
      expect(deletion.softDelete).not.toHaveBeenCalled();
    });

    it('blocks a non-superuser from deleting a superuser', async () => {
      users.getById.mockResolvedValue(makeUser({ isSuperuser: true }));

      const error = await httpError(() => service.remove(actor, 'user-1'));

      expect(error.status).toBe(403);
      expect(error.body.code).toBe(ADMIN_USER_ERRORS.superuserProtected);
      expect(deletion.softDelete).not.toHaveBeenCalled();
    });

    it('lets a superuser delete another superuser', async () => {
      users.getById.mockResolvedValue(makeUser({ isSuperuser: true }));

      await service.remove(makeActor({ isSuperuser: true }), 'user-1');

      expect(deletion.softDelete).toHaveBeenCalledWith('user-1');
    });
  });

  describe('restore', () => {
    it('restores with the stored identifiers when they are still free', async () => {
      const deleted = makeUser({ deletedAt: new Date() });
      users.findByIdWithDeleted.mockResolvedValue(deleted);
      users.findByEmail.mockResolvedValue(null);
      users.findByUsername.mockResolvedValue(null);
      users.getById.mockResolvedValue(makeUser());
      adminProfiles.findProfile.mockResolvedValue(makeProfile());

      const view = await service.restore(actor, 'user-1', {});

      expect(users.restore).toHaveBeenCalledWith('user-1', {
        email: 'jane@example.com',
        username: 'janedoe',
        emailVerifiedAt: deleted.emailVerifiedAt,
        passwordResetRequired: true,
      });
      expect(emailVerification.sendVerificationTo).not.toHaveBeenCalled();
      expect(passwordReset.sendResetLink).toHaveBeenCalledWith(
        'user-1',
        'jane@example.com',
      );
      expect(view).toMatchObject({
        email: 'jane@example.com',
        username: 'janedoe',
        emailVerified: true,
        firstName: 'Jane',
      });
    });

    it('reports the colliding identifiers and does not touch the account', async () => {
      users.findByIdWithDeleted.mockResolvedValue(
        makeUser({ deletedAt: new Date() }),
      );
      users.findByEmail.mockResolvedValue(
        makeUser({ id: 'someone-else', email: 'jane@example.com' }),
      );
      users.findByUsername.mockResolvedValue(
        makeUser({ id: 'someone-else', username: 'janedoe' }),
      );

      const error = await httpError(() => service.restore(actor, 'user-1', {}));

      expect(error.status).toBe(409);
      expect(error.body.code).toBe(USER_ERRORS.restoreConflict);
      // The raw exception carries `conflicts`; the HTTP filter promotes it to
      // `error.meta` (asserted end-to-end in the users e2e spec).
      expect(error.body.conflicts).toEqual(['email', 'username']);
      expect(users.restore).not.toHaveBeenCalled();
      expect(passwordReset.sendResetLink).not.toHaveBeenCalled();
    });

    it('accepts replacement identifiers and re-verifies the new email', async () => {
      users.findByIdWithDeleted.mockResolvedValue(
        makeUser({ deletedAt: new Date() }),
      );
      users.findByEmail.mockResolvedValue(null);
      users.findByUsername.mockResolvedValue(null);
      users.getById.mockResolvedValue(
        makeUser({ email: 'fresh@example.com', emailVerifiedAt: null }),
      );
      adminProfiles.findProfile.mockResolvedValue(null);

      await service.restore(actor, 'user-1', {
        email: 'fresh@example.com',
      });

      expect(users.restore).toHaveBeenCalledWith('user-1', {
        email: 'fresh@example.com',
        username: 'janedoe',
        emailVerifiedAt: null,
        passwordResetRequired: true,
      });
      expect(emailVerification.sendVerificationTo).toHaveBeenCalledWith(
        'user-1',
        'fresh@example.com',
      );
      expect(passwordReset.sendResetLink).toHaveBeenCalledWith(
        'user-1',
        'fresh@example.com',
      );
    });

    it('rejects accounts that are not deleted', async () => {
      users.findByIdWithDeleted.mockResolvedValue(makeUser());

      const error = await httpError(() => service.restore(actor, 'user-1', {}));

      expect(error.status).toBe(400);
      expect(error.body.code).toBe(ADMIN_USER_ERRORS.notDeleted);
      expect(users.restore).not.toHaveBeenCalled();
    });

    it('fails for unknown accounts', async () => {
      users.findByIdWithDeleted.mockResolvedValue(null);

      const error = await httpError(() =>
        service.restore(actor, 'missing', {}),
      );

      expect(error.status).toBe(404);
      expect(error.body.code).toBe(USER_ERRORS.userNotFound);
    });

    it('blocks a non-superuser from restoring a superuser', async () => {
      users.findByIdWithDeleted.mockResolvedValue(
        makeUser({ deletedAt: new Date(), isSuperuser: true }),
      );

      const error = await httpError(() => service.restore(actor, 'user-1', {}));

      expect(error.status).toBe(403);
      expect(error.body.code).toBe(ADMIN_USER_ERRORS.superuserProtected);
      expect(users.restore).not.toHaveBeenCalled();
    });
  });

  describe('attributes', () => {
    it('grants and revokes through the shared engine', async () => {
      users.getById.mockResolvedValue(makeUser());

      await service.grantAttribute(actor, 'user-1', 'users:read');
      await service.revokeAttribute(actor, 'user-1', 'users:read');

      expect(attributes.grantToUser).toHaveBeenCalledWith(
        'admin-1',
        'user-1',
        'users:read',
      );
      expect(attributes.revokeFromUser).toHaveBeenCalledWith(
        'user-1',
        'users:read',
      );
    });

    it('blocks touching a superuser account before calling the engine', async () => {
      users.getById.mockResolvedValue(makeUser({ isSuperuser: true }));

      const error = await httpError(() =>
        service.grantAttribute(actor, 'user-1', 'users:read'),
      );

      expect(error.status).toBe(403);
      expect(error.body.code).toBe(ADMIN_USER_ERRORS.superuserProtected);
      expect(attributes.grantToUser).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('delegates the projected page to the read service', async () => {
      const projected = {
        items: [
          {
            id: 'user-1',
            email: 'jane@example.com',
            username: 'janedoe',
            firstName: 'Jane',
            lastName: 'Doe',
            phone: null,
            isSuperuser: false,
            emailVerified: true,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 'user-2',
            email: 'janet@example.com',
            username: 'janet',
            firstName: 'Janet',
            lastName: null,
            phone: null,
            isSuperuser: false,
            emailVerified: true,
            createdAt: '2026-01-02T00:00:00.000Z',
          },
        ],
        total: 42,
      };
      reads.list.mockResolvedValue(projected);

      const page = await service.list({ offset: 25, limit: 25 });

      expect(reads.list).toHaveBeenCalledWith({ offset: 25, limit: 25 });
      expect(page).toBe(projected);
    });
  });
});

/** UsersService record-primitive mock. */
function createUsersMock() {
  return {
    getById: vi.fn(),
    findByIdWithDeleted: vi.fn(),
    findByEmail: vi.fn(),
    findByUsername: vi.fn(),
    save: vi.fn().mockImplementation((user: User) => Promise.resolve(user)),
    restore: vi.fn().mockResolvedValue(undefined),
  };
}

/** AccountDeletionService mock. */
function createDeletionMock() {
  return {
    softDelete: vi.fn().mockResolvedValue(undefined),
  };
}

/** RefreshTokenService mock. */
function createRefreshTokensMock() {
  return {
    revokeAllForUser: vi.fn().mockResolvedValue(undefined),
  };
}

/** EmailVerificationService mock. */
function createEmailVerificationMock() {
  return {
    sendVerificationTo: vi.fn().mockResolvedValue(undefined),
  };
}

/** EmailChangeService mock. */
function createEmailChangesMock() {
  return {
    purgeForUser: vi.fn().mockResolvedValue(undefined),
  };
}

/** AuthTokenService mock. */
function createAuthTokensMock() {
  return {
    invalidatePending: vi.fn().mockResolvedValue(undefined),
  };
}

/** PasswordResetService mock. */
function createPasswordResetMock() {
  return {
    sendResetLink: vi.fn().mockResolvedValue(undefined),
  };
}

/** AdminUserProfilesService mock. */
function createAdminProfilesMock() {
  return {
    findProfile: vi.fn(),
    updateProfile: vi.fn(),
  };
}

/** AdminUsersReadService mock. */
function createReadsMock() {
  return {
    list: vi.fn(),
    detail: vi.fn(),
  };
}

/** UserProvisioningService mock. */
function createProvisioningMock() {
  return {
    createVerified: vi.fn(),
  };
}

/** AttributesService mock. */
function createAttributesMock() {
  return {
    grantToUser: vi.fn().mockResolvedValue(undefined),
    revokeFromUser: vi.fn().mockResolvedValue(undefined),
  };
}
