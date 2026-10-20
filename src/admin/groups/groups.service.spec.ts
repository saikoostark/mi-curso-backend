import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { ATTRIBUTE_ERRORS } from '../../identity/attributes/attributes.error-codes.js';
import type { AttributesService } from '../../identity/attributes/attributes.service.js';
import type { GroupAttribute } from '../../identity/groups/group-attribute.entity.js';
import type { GroupMember } from '../../identity/groups/group-member.entity.js';
import type { Group } from '../../identity/groups/group.entity.js';
import type { UsersService } from '../../identity/users/users.service.js';
import { GroupsService } from './groups.service.js';

/** Group entity factory for test data. */
function makeGroup(overrides: Partial<Group> = {}): Group {
  return {
    id: 'group-1',
    name: 'Moderators',
    description: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('GroupsService', () => {
  let groupFindOne: ReturnType<typeof vi.fn>;
  let groupExistsBy: ReturnType<typeof vi.fn>;
  let groupSave: ReturnType<typeof vi.fn>;
  let groupCreate: ReturnType<typeof vi.fn>;
  let groupDelete: ReturnType<typeof vi.fn>;
  let groupAttributeDelete: ReturnType<typeof vi.fn>;
  let groupAttributeExecute: ReturnType<typeof vi.fn>;
  let membershipFind: ReturnType<typeof vi.fn>;
  let membershipExecute: ReturnType<typeof vi.fn>;
  let membershipDelete: ReturnType<typeof vi.fn>;
  let groupAttributeKeys: ReturnType<typeof vi.fn>;
  let assertKnown: ReturnType<typeof vi.fn>;
  let assertCanGrant: ReturnType<typeof vi.fn>;
  let usersGetById: ReturnType<typeof vi.fn>;
  let service: GroupsService;

  beforeEach(() => {
    groupFindOne = vi.fn();
    groupExistsBy = vi.fn();
    groupSave = vi
      .fn()
      .mockImplementation((group: Group) => Promise.resolve(group));
    groupCreate = vi.fn().mockImplementation((input: Partial<Group>) => ({
      id: 'group-1',
      ...input,
    }));
    groupDelete = vi.fn();
    groupAttributeDelete = vi.fn();
    groupAttributeExecute = vi.fn();
    membershipFind = vi.fn();
    membershipExecute = vi.fn();
    membershipDelete = vi.fn();
    groupAttributeKeys = vi.fn().mockResolvedValue([]);
    assertKnown = vi.fn().mockResolvedValue(undefined);
    assertCanGrant = vi.fn().mockResolvedValue(undefined);
    usersGetById = vi.fn().mockResolvedValue({ id: 'user-2' });

    const groups = {
      find: vi.fn(),
      findOne: groupFindOne,
      existsBy: groupExistsBy,
      save: groupSave,
      create: groupCreate,
      delete: groupDelete,
    };
    const groupAttributes = {
      delete: groupAttributeDelete,
      createQueryBuilder: () => ({
        insert: () => ({
          values: () => ({
            orIgnore: () => ({ execute: groupAttributeExecute }),
          }),
        }),
      }),
    };
    const memberships = {
      find: membershipFind,
      delete: membershipDelete,
      createQueryBuilder: () => ({
        insert: () => ({
          values: () => ({ orIgnore: () => ({ execute: membershipExecute }) }),
        }),
      }),
    };
    const attributes = {
      attributeKeysOfGroups: vi.fn().mockResolvedValue(new Map()),
      groupAttributeKeys,
      assertKnown,
      assertCanGrant,
    };
    const users = { getById: usersGetById };

    service = new GroupsService(
      groups as unknown as Repository<Group>,
      groupAttributes as unknown as Repository<GroupAttribute>,
      memberships as unknown as Repository<GroupMember>,
      attributes as unknown as AttributesService,
      users as unknown as UsersService,
    );
  });

  describe('create', () => {
    it('rejects duplicate names', async () => {
      groupExistsBy.mockResolvedValue(true);

      await expect(
        service.create({ name: 'Moderators' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(groupSave).not.toHaveBeenCalled();
    });

    it('stores the new group with an empty attribute set', async () => {
      groupExistsBy.mockResolvedValue(false);

      await expect(
        service.create({ name: 'Moderators', description: 'The team.' }),
      ).resolves.toEqual({
        id: 'group-1',
        name: 'Moderators',
        description: 'The team.',
        attributes: [],
      });
    });
  });

  describe('attachAttribute', () => {
    it('validates the key and the subset rule before inserting', async () => {
      groupFindOne.mockResolvedValue(makeGroup());
      groupAttributeKeys.mockResolvedValue(['users:read']);

      await expect(
        service.attachAttribute('actor', 'group-1', 'users:read'),
      ).resolves.toEqual(['users:read']);
      expect(assertKnown).toHaveBeenCalledWith('users:read');
      expect(assertCanGrant).toHaveBeenCalledWith('actor', ['users:read']);
      expect(groupAttributeExecute).toHaveBeenCalledTimes(1);
    });

    it('does not insert when the subset rule denies the grant', async () => {
      groupFindOne.mockResolvedValue(makeGroup());
      assertCanGrant.mockRejectedValue(
        new ForbiddenException({
          code: ATTRIBUTE_ERRORS.insufficientAttributes,
        }),
      );

      await expect(
        service.attachAttribute('actor', 'group-1', 'users:delete'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(groupAttributeExecute).not.toHaveBeenCalled();
    });
  });

  describe('detachAttribute', () => {
    it('deletes the link without subset checks (never escalates)', async () => {
      groupFindOne.mockResolvedValue(makeGroup());
      groupAttributeKeys.mockResolvedValue([]);

      await service.detachAttribute('group-1', 'users:read');

      expect(groupAttributeDelete).toHaveBeenCalledWith({
        groupId: 'group-1',
        attributeKey: 'users:read',
      });
      expect(assertCanGrant).not.toHaveBeenCalled();
    });
  });

  describe('addMember', () => {
    it("checks the actor against the group's current attribute set", async () => {
      groupFindOne.mockResolvedValue(makeGroup());
      groupAttributeKeys.mockResolvedValue(['users:read', 'groups:read']);

      await service.addMember('actor', 'group-1', 'user-2');

      expect(usersGetById).toHaveBeenCalledWith('user-2');
      expect(assertCanGrant).toHaveBeenCalledWith('actor', [
        'users:read',
        'groups:read',
      ]);
      expect(membershipExecute).toHaveBeenCalledTimes(1);
    });

    it('does not insert when the subset rule denies the membership', async () => {
      groupFindOne.mockResolvedValue(makeGroup());
      groupAttributeKeys.mockResolvedValue(['users:delete']);
      assertCanGrant.mockRejectedValue(
        new ForbiddenException({
          code: ATTRIBUTE_ERRORS.insufficientAttributes,
        }),
      );

      await expect(
        service.addMember('actor', 'group-1', 'user-2'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(membershipExecute).not.toHaveBeenCalled();
    });
  });

  describe('removeMember', () => {
    it('deletes the membership without subset checks', async () => {
      groupFindOne.mockResolvedValue(makeGroup());

      await service.removeMember('group-1', 'user-2');

      expect(membershipDelete).toHaveBeenCalledWith({
        groupId: 'group-1',
        userId: 'user-2',
      });
      expect(assertCanGrant).not.toHaveBeenCalled();
    });
  });

  describe('detail', () => {
    it('returns attributes and member ids', async () => {
      groupFindOne.mockResolvedValue(makeGroup({ description: 'The team.' }));
      groupAttributeKeys.mockResolvedValue(['users:read']);
      membershipFind.mockResolvedValue([{ userId: 'user-2' }]);

      await expect(service.detail('group-1')).resolves.toEqual({
        id: 'group-1',
        name: 'Moderators',
        description: 'The team.',
        attributes: ['users:read'],
        members: ['user-2'],
      });
    });
  });
});
