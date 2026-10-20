/**
 * Shared environment helpers for the e2e setup files.
 *
 * Side-effect free — safe to import from both the Vitest main process
 * (global setup) and from workers (setup files).
 */
import { existsSync } from 'node:fs';

/** Scratch directory where e2e runs write file-outbox emails. */
export const TEST_OUTBOX_DIR = 'var/email-outbox-test';

/**
 * Loads `.env` into `process.env` when the file is present. An already-set
 * environment variable always wins over the file (same as `--env-file`).
 */
export function loadDotEnvFile(): void {
  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }
}

/**
 * Reads the dedicated test database connection string, failing fast when it
 * is not configured (see `.env.example`).
 *
 * @returns Postgres connection string for the test database.
 */
export function getTestDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST;

  if (!url) {
    throw new Error(
      'DATABASE_URL_TEST is not set — copy .env.example to .env (see AGENTS.md).',
    );
  }

  return url;
}

/**
 * Reads the dedicated test Redis connection string, failing fast when it is
 * not configured (see `.env.example`).
 *
 * @returns Redis connection string for the test database.
 */
export function getTestRedisUrl(): string {
  const url = process.env.REDIS_URL_TEST;

  if (!url) {
    throw new Error(
      'REDIS_URL_TEST is not set — copy .env.example to .env (see AGENTS.md).',
    );
  }

  return url;
}

/**
 * Refuses to run when the test database is the application database, because
 * e2e specs truncate the data they touch. Must be called before any redirect
 * of `DATABASE_URL` has happened, otherwise the comparison is meaningless.
 */
export function assertTestDatabaseIsDedicated(): void {
  if (getTestDatabaseUrl() === process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL_TEST must point at a dedicated database, not the application one (tests truncate data).',
    );
  }
}

/**
 * Refuses to run when the test Redis URL equals the application one, because
 * e2e specs clear the `auth:*` keys they touch. Point the test URL at a
 * different logical database (e.g. redis://.../1).
 */
export function assertRedisIsDedicated(): void {
  if (getTestRedisUrl() === process.env.REDIS_URL) {
    throw new Error(
      'REDIS_URL_TEST must point at a dedicated Redis database, not the application one (tests clear auth:* keys).',
    );
  }
}
