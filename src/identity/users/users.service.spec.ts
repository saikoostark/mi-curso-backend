import { NotFoundException } from '@nestjs/common';
import type { EntityManager, Repository } from 'typeorm';
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

describe('UsersService', () => {
  let findOne: ReturnType<typeof vi.fn>;
  let save: ReturnType<typeof vi.fn>;
  let create: ReturnType<typeof vi.fn>;
  let softDelete: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let service: UsersService;

  beforeEach(() => {
    findOne = vi.fn();
    save = vi.fn().mockImplementation((user: User) => Promise.resolve(user));
    create = vi
      .fn()
      .mockImplementation((input: Partial<User>) => ({ ...input }));
    softDelete = vi.fn();
    update = vi.fn();

    const repository = {
      findOne,
      save,
      create,
      softDelete,
      update,
    };

    service = new UsersService(repository as unknown as Repository<User>);
  });

  it('loads users by id and fails loudly for unknown ids', async () => {
    findOne.mockResolvedValueOnce(makeUser());

    await expect(service.getById('user-1')).resolves.toMatchObject({
      id: 'user-1',
    });

    findOne.mockResolvedValueOnce(null);

    await expect(service.getById('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('looks users up by identifier, email and username', async () => {
    findOne.mockResolvedValue(makeUser());

    await service.findByIdentifier('jane@example.com');
    await service.findByEmail('jane@example.com');
    await service.findByUsername('janedoe');
    await service.findByIdWithDeleted('user-1');

    expect(findOne).toHaveBeenNthCalledWith(1, {
      where: [{ email: 'jane@example.com' }, { username: 'jane@example.com' }],
    });
    expect(findOne).toHaveBeenNthCalledWith(2, {
      where: { email: 'jane@example.com' },
    });
    expect(findOne).toHaveBeenNthCalledWith(3, {
      where: { username: 'janedoe' },
    });
    // Deleted accounts are only reachable explicitly (restore flows).
    expect(findOne).toHaveBeenNthCalledWith(4, {
      where: { id: 'user-1' },
      withDeleted: true,
    });
  });

  it('creates account records through the repository', async () => {
    await service.createRecord({
      email: 'new@example.com',
      username: 'newbie',
      passwordHash: 'hash',
      emailVerifiedAt: null,
      isSuperuser: false,
    });

    expect(create).toHaveBeenCalledWith({
      email: 'new@example.com',
      username: 'newbie',
      passwordHash: 'hash',
      emailVerifiedAt: null,
      isSuperuser: false,
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('uses the transaction manager for record creation when given one', async () => {
    const managerSave = vi.fn().mockResolvedValue(makeUser());
    const managerCreate = vi
      .fn()
      .mockImplementation((input: Partial<User>) => ({ ...input }));
    const manager = {
      getRepository: vi.fn().mockReturnValue({
        save: managerSave,
        create: managerCreate,
      }),
    } as unknown as EntityManager;

    await service.createRecord(
      {
        email: 'new@example.com',
        username: 'newbie',
        passwordHash: 'hash',
        emailVerifiedAt: null,
        isSuperuser: false,
      },
      manager,
    );

    expect(managerSave).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  it('soft-deletes and restores through the repository', async () => {
    const user = makeUser({ username: 'janet' });

    await service.save(user);
    await service.softDeleteById('user-1');

    expect(save).toHaveBeenCalledWith(user);
    expect(softDelete).toHaveBeenCalledWith({ id: 'user-1' });

    const verifiedAt = new Date('2026-02-01T00:00:00.000Z');
    await service.restore('user-1', {
      email: 'jane@example.com',
      username: 'janedoe',
      emailVerifiedAt: verifiedAt,
      passwordResetRequired: true,
    });

    // One statement: identifiers, the reset flag and the cleared `deletedAt`
    // cannot drift apart — the partial unique indexes reject the whole update
    // on a clash.
    expect(update).toHaveBeenCalledWith(
      { id: 'user-1' },
      {
        email: 'jane@example.com',
        username: 'janedoe',
        emailVerifiedAt: verifiedAt,
        passwordResetRequired: true,
        deletedAt: null,
      },
    );
  });

  it('updates verification and password hash fields in place', async () => {
    const verifiedAt = new Date('2026-02-01T00:00:00.000Z');

    await service.setEmailVerified('user-1', verifiedAt);
    await service.updatePasswordHash('user-1', 'new-hash');

    expect(update).toHaveBeenNthCalledWith(
      1,
      { id: 'user-1' },
      { emailVerifiedAt: verifiedAt },
    );
    expect(update).toHaveBeenNthCalledWith(
      2,
      { id: 'user-1' },
      { passwordHash: 'new-hash', passwordResetRequired: false },
    );
  });
});
