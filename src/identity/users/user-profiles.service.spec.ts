import { NotFoundException } from '@nestjs/common';
import type { EntityManager, Repository } from 'typeorm';
import { UserProfile } from './user-profile.entity.js';
import { UserProfilesService } from './user-profiles.service.js';

/** Profile entity factory for test data. */
function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    userId: 'user-1',
    user: { id: 'user-1' } as UserProfile['user'],
    firstName: 'Jane',
    lastName: 'Doe',
    phone: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('UserProfilesService', () => {
  let findOne: ReturnType<typeof vi.fn>;
  let save: ReturnType<typeof vi.fn>;
  let create: ReturnType<typeof vi.fn>;
  let service: UserProfilesService;

  beforeEach(() => {
    findOne = vi.fn();
    save = vi
      .fn()
      .mockImplementation((profile: UserProfile) => Promise.resolve(profile));
    create = vi
      .fn()
      .mockImplementation((input: Partial<UserProfile>) => ({ ...input }));

    const repository = { findOne, save, create };

    service = new UserProfilesService(
      repository as unknown as Repository<UserProfile>,
    );
  });

  it('creates the profile row of a new account', async () => {
    await service.create({
      userId: 'user-1',
      firstName: null,
      lastName: null,
      phone: null,
    });

    expect(create).toHaveBeenCalledWith({
      userId: 'user-1',
      firstName: null,
      lastName: null,
      phone: null,
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('uses the transaction manager for creation when given one', async () => {
    const managerSave = vi.fn().mockResolvedValue(makeProfile());
    const managerCreate = vi
      .fn()
      .mockImplementation((input: Partial<UserProfile>) => ({ ...input }));
    const manager = {
      getRepository: vi.fn().mockReturnValue({
        save: managerSave,
        create: managerCreate,
      }),
    } as unknown as EntityManager;

    await service.create(
      { userId: 'user-1', firstName: 'Jane', lastName: null, phone: null },
      manager,
    );

    expect(managerSave).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  it('finds one profile by user id', async () => {
    const profile = makeProfile();
    findOne.mockResolvedValue(profile);

    await expect(service.findByUserId('user-1')).resolves.toBe(profile);
    expect(findOne).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
  });

  it('fails loudly when the profile row is missing', async () => {
    findOne.mockResolvedValue(null);

    await expect(service.getByUserId('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('applies partial changes and leaves omitted fields untouched', async () => {
    const profile = makeProfile();
    findOne.mockResolvedValue(profile);

    await service.update('user-1', { firstName: 'Janet', phone: null });

    expect(profile.firstName).toBe('Janet');
    expect(profile.phone).toBeNull();
    expect(profile.lastName).toBe('Doe');
    expect(save).toHaveBeenCalledWith(profile);
  });
});
