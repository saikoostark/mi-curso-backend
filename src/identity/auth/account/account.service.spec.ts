import { HttpException } from '@nestjs/common';
import { PasswordService } from '../../password/password.service.js';
import { TOKEN_ERRORS } from '../../token/token.error-codes.js';
import type { UserProfile } from '../../users/user-profile.entity.js';
import type { User } from '../../users/user.entity.js';
import type { UserProfilesService } from '../../users/user-profiles.service.js';
import type { UsersService } from '../../users/users.service.js';
import { AUTH_ERRORS } from '../auth.error-codes.js';
import type { AccountDeletionService } from './account-deletion.service.js';
import type { PasswordUpdateService } from './password-update.service.js';
import { AccountService } from './account.service.js';
import type { ChangePasswordDto } from './dto/change-password.dto.js';

/** User entity factory for test data. */
function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'jane@example.com',
    username: 'janedoe',
    passwordHash: 'stored-hash',
    emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
    isSuperuser: false,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as unknown as User;
}

/** Profile entity factory for test data. */
function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    userId: 'user-1',
    firstName: 'Jane',
    lastName: 'Doe',
    phone: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as unknown as UserProfile;
}

/** Runs the call and returns the HTTP error body, failing when it resolves. */
async function httpErrorBody(
  run: () => Promise<unknown>,
  status: number,
): Promise<Record<string, unknown>> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    const exception = error as HttpException;
    expect(exception.getStatus()).toBe(status);
    return exception.getResponse() as Record<string, unknown>;
  }

  throw new Error(`Expected a ${status} HttpException`);
}

describe('AccountService', () => {
  let users: ReturnType<typeof createUsersMock>;
  let profiles: ReturnType<typeof createProfilesMock>;
  let passwords: PasswordService;
  let passwordUpdate: ReturnType<typeof createPasswordUpdateMock>;
  let deletion: ReturnType<typeof createDeletionMock>;
  let service: AccountService;

  const dto: ChangePasswordDto = {
    currentPassword: 'OldPassw0rd!x',
    newPassword: 'NewStr0ngPassw',
    passwordConfirm: 'NewStr0ngPassw',
  };

  beforeEach(() => {
    users = createUsersMock();
    profiles = createProfilesMock();
    passwords = new PasswordService();
    passwordUpdate = createPasswordUpdateMock();
    deletion = createDeletionMock();

    service = new AccountService(
      users as unknown as UsersService,
      profiles as unknown as UserProfilesService,
      passwords,
      passwordUpdate as unknown as PasswordUpdateService,
      deletion as unknown as AccountDeletionService,
    );
  });

  describe('changePassword', () => {
    it('rejects a wrong current password without touching state', async () => {
      users.findById.mockResolvedValue(makeUser());
      vi.spyOn(passwords, 'verify').mockResolvedValue(false);

      const body = await httpErrorBody(
        () => service.changePassword('user-1', dto),
        400,
      );

      expect(body.code).toBe(AUTH_ERRORS.invalidCurrentPassword);
      expect(passwordUpdate.updatePassword).not.toHaveBeenCalled();
    });

    it('delegates validation and revocation to the shared password tail', async () => {
      const user = makeUser();
      users.findById.mockResolvedValue(user);
      vi.spyOn(passwords, 'verify').mockResolvedValue(true);

      const result = await service.changePassword('user-1', dto);

      expect(passwordUpdate.updatePassword).toHaveBeenCalledWith(
        user,
        'NewStr0ngPassw',
        'NewStr0ngPassw',
      );
      expect(result.message).toContain('log in again');
    });

    it('rejects when the account vanished', async () => {
      users.findById.mockResolvedValue(null);

      const body = await httpErrorBody(
        () => service.changePassword('user-1', dto),
        401,
      );

      expect(body.code).toBe(TOKEN_ERRORS.invalidToken);
    });
  });

  describe('me', () => {
    it('returns the account with the profile flattened in', async () => {
      users.findById.mockResolvedValue(makeUser());
      profiles.findByUserId.mockResolvedValue(makeProfile());

      const view = await service.me('user-1');

      expect(view).toMatchObject({
        id: 'user-1',
        email: 'jane@example.com',
        emailVerified: true,
        firstName: 'Jane',
        lastName: 'Doe',
        phone: null,
      });
      expect(profiles.findByUserId).toHaveBeenCalledWith('user-1');
    });

    it('renders null profile fields when the row is missing', async () => {
      users.findById.mockResolvedValue(makeUser());
      profiles.findByUserId.mockResolvedValue(null);

      const view = await service.me('user-1');

      expect(view.firstName).toBeNull();
      expect(view.lastName).toBeNull();
    });

    it('rejects when the user vanished', async () => {
      users.findById.mockResolvedValue(null);

      await expect(service.me('user-1')).rejects.toBeInstanceOf(HttpException);
    });
  });

  describe('updateProfile', () => {
    it('applies the provided fields and returns the combined view', async () => {
      users.findById.mockResolvedValue(makeUser());
      profiles.update.mockResolvedValue(
        makeProfile({ firstName: 'Janet', lastName: null, phone: null }),
      );

      const view = await service.updateProfile('user-1', {
        firstName: 'Janet',
        lastName: null,
        phone: null,
      });

      expect(profiles.update).toHaveBeenCalledWith('user-1', {
        firstName: 'Janet',
        lastName: null,
        phone: null,
      });
      expect(view).toMatchObject({
        id: 'user-1',
        email: 'jane@example.com',
        firstName: 'Janet',
        lastName: null,
        phone: null,
      });
    });

    it('passes omitted fields through as undefined so they stay untouched', async () => {
      users.findById.mockResolvedValue(makeUser());
      profiles.update.mockResolvedValue(makeProfile());

      await service.updateProfile('user-1', {});

      expect(profiles.update).toHaveBeenCalledWith('user-1', {
        firstName: undefined,
        lastName: undefined,
        phone: undefined,
      });
    });

    it('rejects when the account vanished', async () => {
      users.findById.mockResolvedValue(null);

      const body = await httpErrorBody(
        () => service.updateProfile('user-1', { firstName: 'Ghost' }),
        401,
      );

      expect(body.code).toBe(TOKEN_ERRORS.invalidToken);
      expect(profiles.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteAccount', () => {
    it('re-checks the password and soft-deletes the account', async () => {
      users.findById.mockResolvedValue(makeUser());
      vi.spyOn(passwords, 'verify').mockResolvedValue(true);

      const result = await service.deleteAccount('user-1', {
        password: 'Str0ngPassw',
        confirm: true,
      });

      expect(deletion.softDelete).toHaveBeenCalledWith('user-1');
      expect(result.message).toContain('deleted');
    });

    it('rejects a wrong password without touching state', async () => {
      users.findById.mockResolvedValue(makeUser());
      vi.spyOn(passwords, 'verify').mockResolvedValue(false);

      const body = await httpErrorBody(
        () =>
          service.deleteAccount('user-1', {
            password: 'Wr0ngPassw',
            confirm: true,
          }),
        400,
      );

      expect(body.code).toBe(AUTH_ERRORS.invalidCurrentPassword);
      expect(deletion.softDelete).not.toHaveBeenCalled();
    });

    it('rejects when the account vanished', async () => {
      users.findById.mockResolvedValue(null);

      const body = await httpErrorBody(
        () =>
          service.deleteAccount('user-1', {
            password: 'Str0ngPassw',
            confirm: true,
          }),
        401,
      );

      expect(body.code).toBe(TOKEN_ERRORS.invalidToken);
      expect(deletion.softDelete).not.toHaveBeenCalled();
    });
  });
});

/** UsersService mock with per-method vi.fn()s. */
function createUsersMock() {
  return {
    findById: vi.fn(),
  };
}

/** UserProfilesService mock with per-method vi.fn()s. */
function createProfilesMock() {
  return {
    findByUserId: vi.fn(),
    update: vi.fn(),
  };
}

/** PasswordUpdateService mock. */
function createPasswordUpdateMock() {
  return {
    updatePassword: vi.fn().mockResolvedValue(undefined),
  };
}

/** AccountDeletionService mock. */
function createDeletionMock() {
  return {
    softDelete: vi.fn().mockResolvedValue(undefined),
  };
}
