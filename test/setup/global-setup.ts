/**
 * Vitest global setup for e2e runs.
 *
 * Validates the test database configuration, then applies pending migrations
 * to the dedicated test database (`DATABASE_URL_TEST`) so specs always run
 * against the latest schema. Nothing is created or assumed beyond that — the
 * database must already exist and be reachable (see AGENTS.md).
 */
import { DataSource } from 'typeorm';
import { buildCliDataSourceOptions } from '../../src/database/data-source-options.js';
import {
  assertTestDatabaseIsDedicated,
  getTestDatabaseUrl,
  loadDotEnvFile,
} from './env.js';

export default async function globalSetup(): Promise<void> {
  loadDotEnvFile();
  assertTestDatabaseIsDedicated();

  const dataSource = new DataSource(
    buildCliDataSourceOptions(getTestDatabaseUrl()),
  );
  await dataSource.initialize();

  try {
    await dataSource.runMigrations();
  } finally {
    await dataSource.destroy();
  }
}
