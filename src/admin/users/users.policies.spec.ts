import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../identity/decorators/current-user.decorator.js';
import type { User } from '../../identity/users/user.entity.js';
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

describe('SuperuserProtectionPolicy', () => {
  const policy = new SuperuserProtectionPolicy();

  it('allows acting on regular accounts', () => {
    expect(() => policy.assertCanModify(makeActor(), makeUser())).not.toThrow();
  });

  it('allows a superuser to modify another superuser', () => {
    expect(() =>
      policy.assertCanModify(
        makeActor({ isSuperuser: true }),
        makeUser({ isSuperuser: true }),
      ),
    ).not.toThrow();
  });

  it('blocks a non-superuser from modifying a superuser', () => {
    let error: unknown;

    try {
      policy.assertCanModify(makeActor(), makeUser({ isSuperuser: true }));
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({
      code: ADMIN_USER_ERRORS.superuserProtected,
    });
  });
});
