import type { DataSourceOptions } from 'typeorm';

/** Glob the CLI uses to find entity classes. */
export const ENTITY_GLOBS = ['src/**/*.entity.ts'];

/** Glob used to find migration classes (CLI and e2e global setup). */
export const MIGRATION_GLOBS = ['src/database/migrations/*.ts'];

/**
 * Connection options shared by the Nest application and the TypeORM CLI.
 *
 * `synchronize` is intentionally disabled: the schema is owned exclusively by
 * the migrations under `src/database/migrations/` (see the `db:migration:*` scripts).
 *
 * @param url - Postgres connection string.
 * @returns Base TypeORM data source options.
 */
export function buildDataSourceOptions(url: string): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    synchronize: false,
    migrationsTableName: 'typeorm_migrations',
    // Use `gen_random_uuid()` (built into Postgres 13+) instead of
    // `uuid_generate_v4()`, which would require the uuid-ossp extension.
    uuidExtension: 'pgcrypto',
  };
}

/**
 * Options used exclusively by the TypeORM CLI (see the `db:*` npm scripts).
 *
 * Unlike the Nest application — which discovers entities through
 * `autoLoadEntities` — the CLI needs explicit globs to diff entities against the
 * database and to load migration classes. The globs target the TypeScript
 * sources because the CLI runs against them through `tsx`.
 *
 * @param url - Postgres connection string.
 * @returns TypeORM data source options for CLI usage.
 */
export function buildCliDataSourceOptions(url: string): DataSourceOptions {
  return {
    ...buildDataSourceOptions(url),
    entities: ENTITY_GLOBS,
    migrations: MIGRATION_GLOBS,
  };
}

/**
 * Migration-only options for running migrations outside the CLI (the e2e
 * global setup).
 *
 * Deliberately omits the entity globs: initializing a DataSource dynamically
 * imports every matched entity file, and the e2e global setup runs in the
 * Vitest main process where Node's built-in TypeScript support cannot strip
 * decorators (see AGENTS.md). Applying migrations does not need entities.
 *
 * @param url - Postgres connection string.
 * @returns TypeORM data source options for migration runs.
 */
export function buildMigrationRunnerOptions(url: string): DataSourceOptions {
  return {
    ...buildDataSourceOptions(url),
    migrations: MIGRATION_GLOBS,
  };
}
