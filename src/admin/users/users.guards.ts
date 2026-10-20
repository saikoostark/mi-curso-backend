import { Injectable } from '@nestjs/common';
import { AttributesService } from '../../identity/attributes/attributes.service.js';
import { AttributeGuard } from '../../identity/guards/attribute.guard.js';
import { USERS_ATTRIBUTES } from '../../identity/users/users.attributes.js';

/**
 * Named capability guards for the `/users` management space.
 *
 * Each guard encapsulates exactly one concrete attribute key, so routes read
 * as `@UseGuards(CanReadUsers)` instead of carrying key metadata. Superusers
 * pass every guard. The guards live with the admin surface because that is
 * where they are consumed; the `AttributeGuard` base and the engine stay in
 * identity.
 */

/** `users:read` — view user accounts and their profiles. */
@Injectable()
export class CanReadUsers extends AttributeGuard {
  protected readonly attributeKeys = [USERS_ATTRIBUTES.read.key];

  constructor(attributes: AttributesService) {
    super(attributes);
  }
}

/** `users:create` — create user accounts (created accounts are pre-verified). */
@Injectable()
export class CanCreateUsers extends AttributeGuard {
  protected readonly attributeKeys = [USERS_ATTRIBUTES.create.key];

  constructor(attributes: AttributesService) {
    super(attributes);
  }
}

/** `users:update` — update user account data. */
@Injectable()
export class CanUpdateUsers extends AttributeGuard {
  protected readonly attributeKeys = [USERS_ATTRIBUTES.update.key];

  constructor(attributes: AttributesService) {
    super(attributes);
  }
}

/** `users:delete` — delete user accounts. */
@Injectable()
export class CanDeleteUsers extends AttributeGuard {
  protected readonly attributeKeys = [USERS_ATTRIBUTES.delete.key];

  constructor(attributes: AttributesService) {
    super(attributes);
  }
}

/** `users:assign_attributes` — grant or revoke attributes directly on users. */
@Injectable()
export class CanAssignUserAttributes extends AttributeGuard {
  protected readonly attributeKeys = [USERS_ATTRIBUTES.assignAttributes.key];

  constructor(attributes: AttributesService) {
    super(attributes);
  }
}
