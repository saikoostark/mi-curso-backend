/**
 * Vitest global setup for e2e runs.
 *
 * Validates the test database/Redis configuration, then applies pending
 * migrations to the dedicated test database (`DATABASE_URL_TEST`) and checks
 * Redis connectivity, so specs always run against the latest schema. Nothing
 * is created or assumed beyond that — both servers must already exist and be
 * reachable (see AGENTS.md). The scratch email-outbox directory is cleared.
 */
import { rm } from 'node:fs/promises';
import { createClient } from 'redis';
import { DataSource } from 'typeorm';
import { buildMigrationRunnerOptions } from '../../src/database/data-source-options.js';
import {
  assertRedisIsDedicated,
  assertTestDatabaseIsDedicated,
  getTestDatabaseUrl,
  getTestRedisUrl,
  loadDotEnvFile,
  TEST_OUTBOX_DIR,
} from './env.js';

export default async function globalSetup(): Promise<void> {
  loadDotEnvFile();
  assertTestDatabaseIsDedicated();
  assertRedisIsDedicated();

  const dataSource = new DataSource(
    buildMigrationRunnerOptions(getTestDatabaseUrl()),
  );
  await dataSource.initialize();

  try {
    await dataSource.runMigrations();
  } finally {
    await dataSource.destroy();
  }

  const redis = createClient({ url: getTestRedisUrl() });
  redis.on('error', () => undefined);
  await redis.connect();

  try {
    await redis.ping();
  } finally {
    await redis.quit();
  }

  await rm(TEST_OUTBOX_DIR, { recursive: true, force: true });
}
