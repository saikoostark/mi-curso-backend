import type { DataSourceOptions } from 'typeorm';

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
    entities: ['src/**/*.entity.ts'],
    migrations: ['src/database/migrations/*.ts'],
  };
}
