import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { GroupAttribute } from '../groups/group-attribute.entity.js';
import type { GroupMember } from '../groups/group-member.entity.js';
import type { UsersService } from '../users/users.service.js';
import type { Attribute } from './attribute.entity.js';
import { ATTRIBUTE_ERRORS } from './attributes.error-codes.js';
import { AttributesService } from './attributes.service.js';
import type { UserAttribute } from './user-attribute.entity.js';

/** Runs the call and returns the HTTP error, failing when it resolves. */
async function httpError(run: () => Promise<unknown>): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  try {
    await run();
  } catch (error) {
    const status =
      error instanceof ForbiddenException
        ? 403
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

describe('AttributesService', () => {
  let catalogFind: ReturnType<typeof vi.fn>;
  let catalogExistsBy: ReturnType<typeof vi.fn>;
  let userAttributesFind: ReturnType<typeof vi.fn>;
  let userAttributesDelete: ReturnType<typeof vi.fn>;
  let userAttributesValues: ReturnType<typeof vi.fn>;
  let userAttributesExecute: ReturnType<typeof vi.fn>;
  let groupAttributesFind: ReturnType<typeof vi.fn>;
  let membershipsFind: ReturnType<typeof vi.fn>;
  let usersFindById: ReturnType<typeof vi.fn>;
  let service: AttributesService;

  beforeEach(() => {
    catalogFind = vi.fn();
    catalogExistsBy = vi.fn();
    userAttributesFind = vi.fn();
    userAttributesDelete = vi.fn();
    userAttributesValues = vi.fn();
    userAttributesExecute = vi.fn();
    groupAttributesFind = vi.fn();
    membershipsFind = vi.fn();
    usersFindById = vi.fn();

    userAttributesValues.mockReturnValue({
      orIgnore: () => ({ execute: userAttributesExecute }),
    });

    const catalog = { find: catalogFind, existsBy: catalogExistsBy };
    const userAttributes = {
      find: userAttributesFind,
      delete: userAttributesDelete,
      createQueryBuilder: () => ({
        insert: () => ({ values: userAttributesValues }),
      }),
    };
    const groupAttributes = { find: groupAttributesFind };
    const memberships = { find: membershipsFind };
    const users = { findById: usersFindById };

    service = new AttributesService(
      catalog as unknown as Repository<Attribute>,
      userAttributes as unknown as Repository<UserAttribute>,
      groupAttributes as unknown as Repository<GroupAttribute>,
      memberships as unknown as Repository<GroupMember>,
      users as unknown as UsersService,
    );
  });

  describe('effectiveKeys', () => {
    it('merges direct grants with group attributes (sorted, deduplicated)', async () => {
      usersFindById.mockResolvedValue({ id: 'user-1', isSuperuser: false });
      userAttributesFind.mockResolvedValue([
        { attributeKey: 'users:update' },
        { attributeKey: 'users:read' },
      ]);
      membershipsFind.mockResolvedValue([
        { groupId: 'group-1' },
        { groupId: 'group-2' },
      ]);
      groupAttributesFind.mockResolvedValue([
        { groupId: 'group-1', attributeKey: 'users:read' },
        { groupId: 'group-1', attributeKey: 'groups:read' },
      ]);

      await expect(service.effectiveKeys('user-1')).resolves.toEqual([
        'groups:read',
        'users:read',
        'users:update',
      ]);
    });

    it('resolves superusers to the whole catalog without extra lookups', async () => {
      usersFindById.mockResolvedValue({ id: 'root', isSuperuser: true });
      catalogFind.mockResolvedValue([
        {
          key: 'users:create',
          description: 'Create users.',
          deprecatedAt: null,
        },
        { key: 'groups:read', description: 'Read groups.', deprecatedAt: null },
      ]);

      await expect(service.effectiveKeys('root')).resolves.toEqual([
        'users:create',
        'groups:read',
      ]);
      expect(userAttributesFind).not.toHaveBeenCalled();
      expect(membershipsFind).not.toHaveBeenCalled();
    });

    it('handles users without any grants', async () => {
      usersFindById.mockResolvedValue({ id: 'user-1', isSuperuser: false });
      userAttributesFind.mockResolvedValue([]);
      membershipsFind.mockResolvedValue([]);

      await expect(service.effectiveKeys('user-1')).resolves.toEqual([]);
    });
  });

  describe('hasAll', () => {
    it('passes when every key is held', async () => {
      usersFindById.mockResolvedValue({ id: 'user-1', isSuperuser: false });
      userAttributesFind.mockResolvedValue([{ attributeKey: 'users:read' }]);
      membershipsFind.mockResolvedValue([]);

      await expect(service.hasAll('user-1', ['users:read'])).resolves.toBe(
        true,
      );
    });

    it('fails when any key is missing', async () => {
      usersFindById.mockResolvedValue({ id: 'user-1', isSuperuser: false });
      userAttributesFind.mockResolvedValue([{ attributeKey: 'users:read' }]);
      membershipsFind.mockResolvedValue([]);

      await expect(
        service.hasAll('user-1', ['users:read', 'users:delete']),
      ).resolves.toBe(false);
    });
  });

  describe('assertCanGrant (subset rule)', () => {
    it('silently accepts an empty set', async () => {
      await expect(
        service.assertCanGrant('actor', []),
      ).resolves.toBeUndefined();
      expect(usersFindById).not.toHaveBeenCalled();
    });

    it('allows granting keys the actor holds', async () => {
      usersFindById.mockResolvedValue({ id: 'actor', isSuperuser: false });
      userAttributesFind.mockResolvedValue([{ attributeKey: 'users:read' }]);
      membershipsFind.mockResolvedValue([]);

      await expect(
        service.assertCanGrant('actor', ['users:read']),
      ).resolves.toBeUndefined();
    });

    it('rejects granting keys the actor does not hold', async () => {
      usersFindById.mockResolvedValue({ id: 'actor', isSuperuser: false });
      userAttributesFind.mockResolvedValue([]);
      membershipsFind.mockResolvedValue([]);

      const error = await httpError(() =>
        service.assertCanGrant('actor', ['users:delete']),
      );

      expect(error.status).toBe(403);
      expect(error.body.code).toBe(ATTRIBUTE_ERRORS.insufficientAttributes);
      expect(error.body.required).toEqual(['users:delete']);
    });

    it('lets superusers grant anything', async () => {
      usersFindById.mockResolvedValue({ id: 'root', isSuperuser: true });
      catalogFind.mockResolvedValue([
        { key: 'users:delete', description: 'x', deprecatedAt: null },
      ]);

      await expect(
        service.assertCanGrant('root', ['users:delete']),
      ).resolves.toBeUndefined();
    });
  });

  describe('assertKnown', () => {
    it('accepts catalog keys', async () => {
      catalogExistsBy.mockResolvedValue(true);

      await expect(service.assertKnown('users:read')).resolves.toBeUndefined();
    });

    it('rejects unknown or deprecated keys with 404', async () => {
      catalogExistsBy.mockResolvedValue(false);

      const error = await httpError(() => service.assertKnown('users:nope'));

      expect(error.status).toBe(404);
      expect(error.body.code).toBe(ATTRIBUTE_ERRORS.unknownAttribute);
    });
  });

  describe('grantToUser', () => {
    it('validates the key and the subset rule, then inserts idempotently', async () => {
      catalogExistsBy.mockResolvedValue(true);
      usersFindById.mockResolvedValue({ id: 'actor', isSuperuser: false });
      userAttributesFind.mockResolvedValue([{ attributeKey: 'users:read' }]);
      membershipsFind.mockResolvedValue([]);

      await service.grantToUser('actor', 'target', 'users:read');

      expect(userAttributesValues).toHaveBeenCalledWith({
        userId: 'target',
        attributeKey: 'users:read',
      });
      expect(userAttributesExecute).toHaveBeenCalledTimes(1);
    });

    it('does not insert when the actor lacks the key', async () => {
      catalogExistsBy.mockResolvedValue(true);
      usersFindById.mockResolvedValue({ id: 'actor', isSuperuser: false });
      userAttributesFind.mockResolvedValue([]);
      membershipsFind.mockResolvedValue([]);

      await expect(
        service.grantToUser('actor', 'target', 'users:delete'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(userAttributesExecute).not.toHaveBeenCalled();
    });
  });

  it('revokeFromUser deletes the grant without catalog checks', async () => {
    await service.revokeFromUser('target', 'users:read');

    expect(userAttributesDelete).toHaveBeenCalledWith({
      userId: 'target',
      attributeKey: 'users:read',
    });
    expect(catalogExistsBy).not.toHaveBeenCalled();
  });

  describe('attributeKeysOfGroups', () => {
    it('returns sorted keys per group and empty arrays for unknown ids', async () => {
      groupAttributesFind.mockResolvedValue([
        { groupId: 'group-1', attributeKey: 'users:read' },
        { groupId: 'group-1', attributeKey: 'groups:read' },
      ]);

      const map = await service.attributeKeysOfGroups(['group-1', 'group-2']);

      expect(map.get('group-1')).toEqual(['groups:read', 'users:read']);
      expect(map.get('group-2')).toEqual([]);
    });

    it('skips the query entirely for an empty input', async () => {
      await expect(service.attributeKeysOfGroups([])).resolves.toEqual(
        new Map(),
      );
      expect(groupAttributesFind).not.toHaveBeenCalled();
    });
  });
});
