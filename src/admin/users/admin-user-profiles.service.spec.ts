import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../identity/decorators/current-user.decorator.js';
import type { UserProfile } from '../../identity/users/user-profile.entity.js';
import type { UserProfilesService } from '../../identity/users/user-profiles.service.js';
import type { User } from '../../identity/users/user.entity.js';
import { AdminUserProfilesService } from './admin-user-profiles.service.js';
import { SuperuserProtectionPolicy } from './users.policies.js';

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

describe('AdminUserProfilesService', () => {
  let findProfile: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let service: AdminUserProfilesService;

  beforeEach(() => {
    findProfile = vi.fn();
    update = vi.fn();
    service = new AdminUserProfilesService(
      {
        findByUserId: findProfile,
        update,
      } as unknown as UserProfilesService,
      new SuperuserProtectionPolicy(),
    );
  });

  it('reads profiles through the identity primitive', async () => {
    findProfile.mockResolvedValue(makeProfile());

    await expect(service.findProfile('user-1')).resolves.toMatchObject({
      firstName: 'Jane',
    });
    expect(findProfile).toHaveBeenCalledWith('user-1');
  });

  it('updates the profile of an allowed target', async () => {
    const user = makeUser();
    const changes = { firstName: 'Janet' };
    update.mockResolvedValue(makeProfile({ firstName: 'Janet' }));

    const result = await service.updateProfile(makeActor(), user, changes);

    expect(result.firstName).toBe('Janet');
    expect(update).toHaveBeenCalledWith('user-1', changes);
  });

  it('blocks a non-superuser from editing a superuser profile', async () => {
    const user = makeUser({ isSuperuser: true });

    await expect(
      service.updateProfile(makeActor(), user, { firstName: 'Hacked' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it('lets a superuser edit a superuser profile', async () => {
    const user = makeUser({ isSuperuser: true });
    update.mockResolvedValue(makeProfile());

    await service.updateProfile(makeActor({ isSuperuser: true }), user, {
      firstName: 'Root',
    });

    expect(update).toHaveBeenCalledWith('user-1', { firstName: 'Root' });
  });
});
