/**
 * A single authorization attribute owned by a module part.
 *
 * Keys are concrete `module:action` strings — there are no wildcards and no
 * grouping syntax; every grant is made key by key.
 */
export interface AttributeDefinition {
  /** Concrete key in `module:action` form (no wildcards). */
  key: string;
  /** Human-readable description stored in the attribute catalog. */
  description: string;
}

/**
 * Typing helper for attribute manifests.
 *
 * Each module part exports its own manifest (e.g. `users.attributes.ts`); the
 * tooling-only `attribute-registry.ts` collects them so seed migrations can
 * diff the declared catalog against the database.
 *
 * @param definitions - The part's attribute definitions.
 * @returns The same definitions, preserving literal key types.
 */
export function defineAttributes<T extends Record<string, AttributeDefinition>>(
  definitions: T,
): T {
  return definitions;
}
