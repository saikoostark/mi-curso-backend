import type { DataSource, EntityManager } from 'typeorm';
import { UserProfile } from './user-profile.entity.js';
import { UserProfilesService } from './user-profiles.service.js';
import { UserProvisioningService } from './user-provisioning.service.js';
import { User } from './user.entity.js';
import { UsersService } from './users.service.js';

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
    user: makeUser() as UserProfile['user'],
    firstName: 'Jane',
    lastName: 'Doe',
    phone: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('UserProvisioningService', () => {
  let createRecord: ReturnType<typeof vi.fn>;
  let createProfile: ReturnType<typeof vi.fn>;
  let transaction: ReturnType<typeof vi.fn>;
  let service: UserProvisioningService;

  beforeEach(() => {
    createRecord = vi.fn().mockResolvedValue(makeUser());
    createProfile = vi.fn().mockResolvedValue(makeProfile());
    transaction = vi
      .fn()
      .mockImplementation(
        async (run: (manager: EntityManager) => Promise<unknown>) =>
          run({} as EntityManager),
      );

    service = new UserProvisioningService(
      { transaction } as unknown as DataSource,
      { createRecord } as unknown as UsersService,
      { create: createProfile } as unknown as UserProfilesService,
    );
  });

  it('creates the account and profile in one transaction', async () => {
    const result = await service.createUnverified({
      email: 'jane@example.com',
      username: 'janedoe',
      passwordHash: 'hash',
      profile: { firstName: 'Jane', lastName: 'Doe', phone: null },
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(createRecord).toHaveBeenCalledWith(
      {
        email: 'jane@example.com',
        username: 'janedoe',
        passwordHash: 'hash',
        emailVerifiedAt: null,
        isSuperuser: false,
      },
      expect.anything(),
    );
    expect(createProfile).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        firstName: 'Jane',
        lastName: 'Doe',
        phone: null,
      },
      expect.anything(),
    );
    expect(result.user.id).toBe('user-1');
    expect(result.profile.userId).toBe('user-1');
  });

  it('marks admin-created accounts as verified non-superusers', async () => {
    await service.createVerified({
      email: 'jane@example.com',
      username: 'janedoe',
      passwordHash: 'hash',
      profile: { firstName: null, lastName: null, phone: null },
    });

    expect(createRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        emailVerifiedAt: expect.any(Date),
        isSuperuser: false,
      }),
      expect.anything(),
    );
  });

  it('creates superusers with an empty profile', async () => {
    await service.createSuperuser({
      email: 'root@example.com',
      username: 'root',
      passwordHash: 'hash',
    });

    expect(createRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        emailVerifiedAt: expect.any(Date),
        isSuperuser: true,
      }),
      expect.anything(),
    );
    expect(createProfile).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        firstName: null,
        lastName: null,
        phone: null,
      },
      expect.anything(),
    );
  });

  it('rolls back when either insert fails', async () => {
    createProfile.mockRejectedValue(new Error('profile insert failed'));

    await expect(
      service.createUnverified({
        email: 'jane@example.com',
        username: 'janedoe',
        passwordHash: 'hash',
        profile: { firstName: null, lastName: null, phone: null },
      }),
    ).rejects.toThrow('profile insert failed');
  });
});
