import { defineAttributes } from '../identity/attributes/define-attributes.js';

/**
 * Attributes owned by the audit part.
 *
 * Reading the audit trail is deliberately separate from reading users or
 * groups: an operator can inspect accounts without seeing security history,
 * and vice versa.
 */
export const AUDIT_ATTRIBUTES = defineAttributes({
  read: {
    key: 'audit:read',
    description: 'Read the audit log.',
  },
});
