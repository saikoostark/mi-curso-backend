import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AttributesService } from '../../identity/attributes/attributes.service.js';
import { GroupAttribute } from '../../identity/groups/group-attribute.entity.js';
import { GroupMember } from '../../identity/groups/group-member.entity.js';
import { Group } from '../../identity/groups/group.entity.js';
import { UsersService } from '../../identity/users/users.service.js';
import { GROUP_ERRORS } from './groups.error-codes.js';

/** A group as returned by the API. */
export interface GroupView {
  id: string;
  name: string;
  description: string | null;
  attributes: string[];
}

/** A group with its member ids. */
export interface GroupDetail extends GroupView {
  members: string[];
}

/**
 * Mutable group fields; `undefined` leaves a field untouched, `null` clears
 * the description.
 */
export interface UpdateGroupChanges {
  name?: string;
  description?: string | null;
}

/**
 * Owns the group tables: CRUD, membership and attribute attachment.
 *
 * Enforcement lives here (single source of truth, unit-testable):
 * - attachment and membership additions follow the delegation subset rule
 *   (`AttributesService.assertCanGrant`) — you can only hand out attributes
 *   you effectively hold yourself (superusers bypass);
 * - removals never escalate power and only need the route's `groups:*`
 *   attribute, checked by the capability guards (`CanManageGroupMembers`,
 *   `CanManageGroupAttributes`).
 */
@Injectable()
export class GroupsService {
  constructor(
    @InjectRepository(Group)
    private readonly groups: Repository<Group>,
    @InjectRepository(GroupAttribute)
    private readonly groupAttributes: Repository<GroupAttribute>,
    @InjectRepository(GroupMember)
    private readonly memberships: Repository<GroupMember>,
    private readonly attributes: AttributesService,
    private readonly users: UsersService,
  ) {}

  /**
   * Lists all groups (name order) with their attribute keys.
   *
   * @returns Group views.
   */
  async list(): Promise<GroupView[]> {
    const groups = await this.groups.find({ order: { name: 'ASC' } });
    const attributeMap = await this.attributes.attributeKeysOfGroups(
      groups.map((group) => group.id),
    );

    return groups.map((group) =>
      this.toView(group, attributeMap.get(group.id) ?? []),
    );
  }

  /**
   * Loads one group or fails.
   *
   * @param id - Group id.
   * @returns The group entity.
   * @throws NotFoundException when no such group exists.
   */
  async getById(id: string): Promise<Group> {
    const group = await this.groups.findOne({ where: { id } });
    if (!group) {
      throw new NotFoundException({
        code: GROUP_ERRORS.groupNotFound,
        message: 'Group not found.',
      });
    }

    return group;
  }

  /**
   * Loads one group with its attributes and member ids.
   *
   * @param id - Group id.
   * @returns Group detail.
   * @throws NotFoundException when no such group exists.
   */
  async detail(id: string): Promise<GroupDetail> {
    const group = await this.getById(id);
    const attributes = await this.attributes.groupAttributeKeys(id);
    const members = await this.memberships.find({
      where: { groupId: id },
      order: { createdAt: 'ASC' },
    });

    return {
      ...this.toView(group, attributes),
      members: members.map((member) => member.userId),
    };
  }

  /**
   * Creates a group.
   *
   * @param input - Name and optional description.
   * @returns The new group.
   * @throws ConflictException when the name is taken.
   */
  async create(input: {
    name: string;
    description?: string | null;
  }): Promise<GroupView> {
    if (await this.groups.existsBy({ name: input.name })) {
      throw new ConflictException({
        code: GROUP_ERRORS.groupNameTaken,
        message: 'A group with that name already exists.',
      });
    }

    const group = await this.groups.save(
      this.groups.create({
        name: input.name,
        description: input.description ?? null,
      }),
    );

    return this.toView(group, []);
  }

  /**
   * Updates a group's metadata.
   *
   * @param id - Group id.
   * @param changes - Fields to change.
   * @returns The updated group.
   * @throws NotFoundException when no such group exists.
   * @throws ConflictException when the new name is taken.
   */
  async update(id: string, changes: UpdateGroupChanges): Promise<GroupView> {
    const group = await this.getById(id);

    if (changes.name !== undefined && changes.name !== group.name) {
      if (await this.groups.existsBy({ name: changes.name })) {
        throw new ConflictException({
          code: GROUP_ERRORS.groupNameTaken,
          message: 'A group with that name already exists.',
        });
      }
      group.name = changes.name;
    }

    if (changes.description !== undefined) {
      group.description = changes.description;
    }

    await this.groups.save(group);
    const attributes = await this.attributes.groupAttributeKeys(id);
    return this.toView(group, attributes);
  }

  /**
   * Deletes a group; attribute links and memberships cascade.
   *
   * @param id - Group id.
   * @throws NotFoundException when no such group exists.
   */
  async remove(id: string): Promise<void> {
    await this.getById(id);
    await this.groups.delete({ id });
  }

  /**
   * Attaches an attribute to a group (idempotent).
   *
   * @param actorId - User performing the change (subset rule applies).
   * @param groupId - Group id.
   * @param key - Attribute key to attach.
   * @returns The group's attribute keys after the change.
   * @throws NotFoundException when the group or attribute is unknown.
   * @throws ForbiddenException when the actor does not hold the key.
   */
  async attachAttribute(
    actorId: string,
    groupId: string,
    key: string,
  ): Promise<string[]> {
    await this.getById(groupId);
    await this.attributes.assertKnown(key);
    await this.attributes.assertCanGrant(actorId, [key]);

    await this.groupAttributes
      .createQueryBuilder()
      .insert()
      .values({ groupId, attributeKey: key })
      .orIgnore()
      .execute();

    return this.attributes.groupAttributeKeys(groupId);
  }

  /**
   * Detaches an attribute from a group (idempotent).
   *
   * Detaching never grants power, so only the route's
   * `groups:manage_attributes` attribute is required.
   *
   * @param groupId - Group id.
   * @param key - Attribute key to detach.
   * @returns The group's attribute keys after the change.
   * @throws NotFoundException when no such group exists.
   */
  async detachAttribute(groupId: string, key: string): Promise<string[]> {
    await this.getById(groupId);

    await this.groupAttributes.delete({ groupId, attributeKey: key });
    return this.attributes.groupAttributeKeys(groupId);
  }

  /**
   * Adds a member to a group (idempotent).
   *
   * Membership grants every attribute the group carries, so the subset rule
   * is enforced against the group's current attribute set.
   *
   * @param actorId - User performing the change (subset rule applies).
   * @param groupId - Group id.
   * @param userId - User to add.
   * @throws NotFoundException when the group or user is unknown.
   * @throws ForbiddenException when the actor does not hold the group's attributes.
   */
  async addMember(
    actorId: string,
    groupId: string,
    userId: string,
  ): Promise<void> {
    await this.getById(groupId);
    await this.users.getById(userId);

    const granted = await this.attributes.groupAttributeKeys(groupId);
    await this.attributes.assertCanGrant(actorId, granted);

    await this.memberships
      .createQueryBuilder()
      .insert()
      .values({ groupId, userId })
      .orIgnore()
      .execute();
  }

  /**
   * Removes a member from a group (idempotent).
   *
   * Removing never grants power, so only the route's
   * `groups:manage_members` attribute is required.
   *
   * @param groupId - Group id.
   * @param userId - User to remove.
   * @throws NotFoundException when no such group exists.
   */
  async removeMember(groupId: string, userId: string): Promise<void> {
    await this.getById(groupId);
    await this.memberships.delete({ groupId, userId });
  }

  /** Maps a group entity plus its attribute keys to the API shape. */
  private toView(group: Group, attributes: string[]): GroupView {
    return {
      id: group.id,
      name: group.name,
      description: group.description,
      attributes,
    };
  }
}
