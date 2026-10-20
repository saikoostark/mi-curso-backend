import type { UserProfile } from './user-profile.entity.js';
import type { User } from './user.entity.js';
import { toUserView, toUserViewFromRow } from './user.view.js';

/** User entity factory for test data. */
function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'jane@example.com',
    username: 'janedoe',
    passwordHash: 'stored-hash',
    emailVerifiedAt: null,
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

describe('user view mappers', () => {
  it('combines an account and profile and never includes the password hash', () => {
    const view = toUserView(makeUser(), makeProfile());

    expect(view).toEqual({
      id: 'user-1',
      email: 'jane@example.com',
      username: 'janedoe',
      firstName: 'Jane',
      lastName: 'Doe',
      phone: null,
      isSuperuser: false,
      emailVerified: false,
      deletedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(view).not.toHaveProperty('passwordHash');
  });

  it('maps raw projection rows, including nullable profile fields', () => {
    const view = toUserViewFromRow({
      id: 'user-2',
      email: 'janet@example.com',
      username: 'janet',
      isSuperuser: true,
      emailVerifiedAt: '2026-01-02T00:00:00.000Z',
      deletedAt: null,
      createdAt: '2026-01-02T00:00:00.000Z',
      firstName: null,
      lastName: null,
      phone: '+4915112345678',
    });

    expect(view).toEqual({
      id: 'user-2',
      email: 'janet@example.com',
      username: 'janet',
      firstName: null,
      lastName: null,
      phone: '+4915112345678',
      isSuperuser: true,
      emailVerified: true,
      deletedAt: null,
      createdAt: '2026-01-02T00:00:00.000Z',
    });
  });
});
