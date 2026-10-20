import { Injectable } from '@nestjs/common';
import { AttributesService } from '../../identity/attributes/attributes.service.js';
import { GROUPS_ATTRIBUTES } from '../../identity/groups/groups.attributes.js';
import { AttributeGuard } from '../../identity/guards/attribute.guard.js';

/**
 * Named capability guards for the `/groups` management space.
 *
 * Each guard encapsulates exactly one concrete attribute key, so routes read
 * as `@UseGuards(CanManageGroupMembers)` instead of carrying key metadata.
 * Superusers pass every guard. The guards live with the admin surface because
 * that is where they are consumed; the `AttributeGuard` base and the engine
 * stay in identity.
 */

/** `groups:read` — view groups, their members and their attributes. */
@Injectable()
export class CanReadGroups extends AttributeGuard {
  protected readonly attributeKeys = [GROUPS_ATTRIBUTES.read.key];

  constructor(attributes: AttributesService) {
    super(attributes);
  }
}

/** `groups:create` — create groups. */
@Injectable()
export class CanCreateGroups extends AttributeGuard {
  protected readonly attributeKeys = [GROUPS_ATTRIBUTES.create.key];

  constructor(attributes: AttributesService) {
    super(attributes);
  }
}

/** `groups:update` — update a group name and description. */
@Injectable()
export class CanUpdateGroups extends AttributeGuard {
  protected readonly attributeKeys = [GROUPS_ATTRIBUTES.update.key];

  constructor(attributes: AttributesService) {
    super(attributes);
  }
}

/** `groups:delete` — delete groups (links and memberships cascade). */
@Injectable()
export class CanDeleteGroups extends AttributeGuard {
  protected readonly attributeKeys = [GROUPS_ATTRIBUTES.delete.key];

  constructor(attributes: AttributesService) {
    super(attributes);
  }
}

/** `groups:manage_attributes` — attach or detach attributes on a group. */
@Injectable()
export class CanManageGroupAttributes extends AttributeGuard {
  protected readonly attributeKeys = [GROUPS_ATTRIBUTES.manageAttributes.key];

  constructor(attributes: AttributesService) {
    super(attributes);
  }
}

/** `groups:manage_members` — add or remove members of a group. */
@Injectable()
export class CanManageGroupMembers extends AttributeGuard {
  protected readonly attributeKeys = [GROUPS_ATTRIBUTES.manageMembers.key];

  constructor(attributes: AttributesService) {
    super(attributes);
  }
}
