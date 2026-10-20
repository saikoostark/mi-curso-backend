import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { GroupAttribute } from '../groups/group-attribute.entity.js';
import { GroupMember } from '../groups/group-member.entity.js';
import { UsersService } from '../users/users.service.js';
import { Attribute } from './attribute.entity.js';
import { ATTRIBUTE_ERRORS } from './attributes.error-codes.js';
import { UserAttribute } from './user-attribute.entity.js';

/** Public catalog entry exposed by `GET /attributes`. */
export interface AttributeView {
  key: string;
  description: string;
}

/**
 * The authorization engine: computes effective attribute sets and owns every
 * write to the direct-grant table.
 *
 * Effective set = direct grants ∪ attributes of every group the user belongs
 * to. Superusers effectively hold the whole catalog, which also makes them
 * pass the delegation rule below. Delegation follows the **subset rule**: an
 * actor may only grant keys it effectively holds itself (`assertCanGrant`),
 * so nobody can hand out power they never had.
 */
@Injectable()
export class AttributesService {
  constructor(
    @InjectRepository(Attribute)
    private readonly catalog: Repository<Attribute>,
    @InjectRepository(UserAttribute)
    private readonly userAttributes: Repository<UserAttribute>,
    @InjectRepository(GroupAttribute)
    private readonly groupAttributes: Repository<GroupAttribute>,
    @InjectRepository(GroupMember)
    private readonly memberships: Repository<GroupMember>,
    private readonly users: UsersService,
  ) {}

  /**
   * Lists the non-deprecated catalog, ordered by key.
   *
   * @returns Catalog entries for admin UIs.
   */
  async listCatalog(): Promise<AttributeView[]> {
    const rows = await this.catalog.find({
      where: { deprecatedAt: IsNull() },
      order: { key: 'ASC' },
    });

    return rows.map((row) => ({ key: row.key, description: row.description }));
  }

  /**
   * Computes the effective attribute keys of a user (sorted).
   *
   * Superusers hold the entire catalog; everyone else holds the union of
   * direct grants and the attributes of their groups.
   *
   * @param userId - User to resolve.
   * @returns Sorted effective keys.
   */
  async effectiveKeys(userId: string): Promise<string[]> {
    const user = await this.users.findById(userId);
    if (user?.isSuperuser) {
      return (await this.listCatalog()).map((entry) => entry.key);
    }

    const direct = await this.userAttributes.find({ where: { userId } });
    const memberships = await this.memberships.find({ where: { userId } });
    const viaGroups = await this.attributeKeysOfGroups(
      memberships.map((membership) => membership.groupId),
    );

    const keys = new Set(direct.map((row) => row.attributeKey));
    for (const groupKeys of viaGroups.values()) {
      for (const key of groupKeys) {
        keys.add(key);
      }
    }

    return [...keys].sort();
  }

  /**
   * Tests whether a user effectively holds every given key.
   *
   * Superusers pass unconditionally (they hold the whole catalog).
   *
   * @param userId - User to test.
   * @param requiredKeys - Keys that must all be held.
   * @returns `true` when every key is held.
   */
  async hasAll(userId: string, requiredKeys: string[]): Promise<boolean> {
    const effective = new Set(await this.effectiveKeys(userId));
    return requiredKeys.every((key) => effective.has(key));
  }

  /**
   * Enforces the subset rule for granting.
   *
   * @param actorId - User attempting to grant.
   * @param keys - Keys to be granted.
   * @throws ForbiddenException when the actor does not hold every key.
   */
  async assertCanGrant(actorId: string, keys: string[]): Promise<void> {
    if (keys.length === 0 || (await this.hasAll(actorId, keys))) {
      return;
    }

    throw new ForbiddenException({
      code: ATTRIBUTE_ERRORS.insufficientAttributes,
      message: 'You can only grant attributes you effectively hold.',
      required: keys,
    });
  }

  /**
   * Checks that a key exists in the catalog and is not deprecated.
   *
   * @param key - Attribute key.
   * @throws NotFoundException when the key is unknown or deprecated.
   */
  async assertKnown(key: string): Promise<void> {
    const known = await this.catalog.existsBy({
      key,
      deprecatedAt: IsNull(),
    });

    if (!known) {
      throw new NotFoundException({
        code: ATTRIBUTE_ERRORS.unknownAttribute,
        message: `Attribute "${key}" does not exist or is deprecated.`,
      });
    }
  }

  /**
   * Reads the attribute keys of several groups in one query.
   *
   * @param groupIds - Groups to resolve.
   * @returns Map of group id to sorted attribute keys (empty for unknown ids).
   */
  async attributeKeysOfGroups(
    groupIds: string[],
  ): Promise<Map<string, string[]>> {
    const byGroup = new Map<string, string[]>(
      groupIds.map((id) => [id, []] as [string, string[]]),
    );

    if (groupIds.length === 0) {
      return byGroup;
    }

    const rows = await this.groupAttributes.find({
      where: { groupId: In(groupIds) },
    });

    for (const row of rows) {
      byGroup.get(row.groupId)?.push(row.attributeKey);
    }

    for (const keys of byGroup.values()) {
      keys.sort();
    }

    return byGroup;
  }

  /**
   * Reads the attribute keys of one group.
   *
   * @param groupId - Group to resolve.
   * @returns Sorted attribute keys.
   */
  async groupAttributeKeys(groupId: string): Promise<string[]> {
    return (await this.attributeKeysOfGroups([groupId])).get(groupId) ?? [];
  }

  /**
   * Grants an attribute directly on a user (idempotent).
   *
   * @param actorId - User performing the grant (subset rule applies).
   * @param userId - Target user.
   * @param key - Attribute key to grant.
   * @throws NotFoundException when the key is unknown or deprecated.
   * @throws ForbiddenException when the actor does not hold the key.
   */
  async grantToUser(
    actorId: string,
    userId: string,
    key: string,
  ): Promise<void> {
    await this.assertKnown(key);
    await this.assertCanGrant(actorId, [key]);

    await this.userAttributes
      .createQueryBuilder()
      .insert()
      .values({ userId, attributeKey: key })
      .orIgnore()
      .execute();
  }

  /**
   * Revokes a direct grant from a user (idempotent).
   *
   * Deliberately does not require the key to be non-deprecated: cleaning up
   * grants that predate a deprecation must stay possible, and revoking never
   * escalates power.
   *
   * @param userId - Target user.
   * @param key - Attribute key to revoke.
   */
  async revokeFromUser(userId: string, key: string): Promise<void> {
    await this.userAttributes.delete({ userId, attributeKey: key });
  }
}
