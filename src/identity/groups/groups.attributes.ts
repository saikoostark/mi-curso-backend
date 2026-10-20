import { defineAttributes } from '../attributes/define-attributes.js';

/**
 * Attributes owned by the groups part.
 *
 * Groups are attribute pools: attaching an attribute to a group grants it to
 * every member, and authorization decisions only ever compare concrete keys.
 */
export const GROUPS_ATTRIBUTES = defineAttributes({
  create: {
    key: 'groups:create',
    description: 'Create groups.',
  },
  read: {
    key: 'groups:read',
    description: 'View groups, their members and their attributes.',
  },
  update: {
    key: 'groups:update',
    description: 'Update a group name and description.',
  },
  delete: {
    key: 'groups:delete',
    description: 'Delete groups (memberships and attribute links cascade).',
  },
  manageMembers: {
    key: 'groups:manage_members',
    description: 'Add or remove members of a group.',
  },
  manageAttributes: {
    key: 'groups:manage_attributes',
    description: 'Attach or detach attributes on a group.',
  },
});
