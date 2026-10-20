import { defineAttributes } from '../attributes/define-attributes.js';

/**
 * Attributes owned by the users part.
 *
 * Every action an admin can perform on user accounts maps to exactly one
 * concrete key; there is no implicit access, so a role is just a named set of
 * these keys (or a group, in authorization terms).
 */
export const USERS_ATTRIBUTES = defineAttributes({
  create: {
    key: 'users:create',
    description: 'Create user accounts (created accounts are pre-verified).',
  },
  read: {
    key: 'users:read',
    description: 'View user accounts and their profiles.',
  },
  update: {
    key: 'users:update',
    description: 'Update user account data.',
  },
  delete: {
    key: 'users:delete',
    description: 'Delete user accounts.',
  },
  assignAttributes: {
    key: 'users:assign_attributes',
    description: 'Grant or revoke attributes directly on users.',
  },
});
