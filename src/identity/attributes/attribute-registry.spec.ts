import { ATTRIBUTE_REGISTRY } from './attribute-registry.js';
import { AUDIT_ATTRIBUTES } from '../../audit/audit.attributes.js';
import { GROUPS_ATTRIBUTES } from '../groups/groups.attributes.js';
import { USERS_ATTRIBUTES } from '../users/users.attributes.js';

describe('ATTRIBUTE_REGISTRY', () => {
  it('collects the attributes of every part manifest', () => {
    const registryKeys = ATTRIBUTE_REGISTRY.map((def) => def.key).sort();
    const manifestKeys = [
      ...Object.values(USERS_ATTRIBUTES),
      ...Object.values(GROUPS_ATTRIBUTES),
      ...Object.values(AUDIT_ATTRIBUTES),
    ]
      .map((def) => def.key)
      .sort();

    expect(registryKeys).toEqual(manifestKeys);
  });

  it('declares every key exactly once', () => {
    const keys = ATTRIBUTE_REGISTRY.map((def) => def.key);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('uses concrete module:action keys without wildcards', () => {
    for (const definition of ATTRIBUTE_REGISTRY) {
      expect(definition.key).toMatch(/^[a-z][a-z_]*:[a-z][a-z_]*$/);
    }
  });

  it('describes every attribute', () => {
    for (const definition of ATTRIBUTE_REGISTRY) {
      expect(definition.description.trim().length).toBeGreaterThan(0);
    }
  });

  it('seeds exactly the keys the parts guard against today', () => {
    expect(ATTRIBUTE_REGISTRY.map((def) => def.key).sort()).toEqual([
      'audit:read',
      'groups:create',
      'groups:delete',
      'groups:manage_attributes',
      'groups:manage_members',
      'groups:read',
      'groups:update',
      'users:assign_attributes',
      'users:create',
      'users:delete',
      'users:read',
      'users:update',
    ]);
  });
});
