import { AUDIT_ATTRIBUTES } from '../../audit/audit.attributes.js';
import { GROUPS_ATTRIBUTES } from '../groups/groups.attributes.js';
import { USERS_ATTRIBUTES } from '../users/users.attributes.js';
import type { AttributeDefinition } from './define-attributes.js';

/**
 * The complete attribute catalog, collected from every part's manifest.
 *
 * **Tooling-only**: imported by the seed-migration generator
 * (`npm run db:migration:attributes`) and by `attribute-registry.spec.ts`.
 * Application code must never import this file — parts export their own
 * manifests (`users.attributes.ts`, `groups/groups.attributes.ts`) and
 * controllers reference keys through those, keeping the runtime dependency
 * graph free of cross-part registry imports.
 */
export const ATTRIBUTE_REGISTRY: readonly AttributeDefinition[] = [
  ...Object.values(USERS_ATTRIBUTES),
  ...Object.values(GROUPS_ATTRIBUTES),
  ...Object.values(AUDIT_ATTRIBUTES),
];
