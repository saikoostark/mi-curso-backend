/**
 * Setup file for e2e runs (executed in every worker before test files load).
 *
 * Loads `.env` and redirects the application to the dedicated test database
 * (`DATABASE_URL_TEST`), the dedicated test Redis database (`REDIS_URL_TEST`)
 * and a scratch email-outbox directory. Configuration mistakes (missing or
 * non-dedicated test targets) are caught earlier, in the Vitest global setup.
 */
import {
  getTestDatabaseUrl,
  getTestRedisUrl,
  loadDotEnvFile,
  TEST_OUTBOX_DIR,
} from './env.js';

loadDotEnvFile();

// Point the application (booted inside this worker) at the test targets.
process.env.DATABASE_URL = getTestDatabaseUrl();
process.env.REDIS_URL = getTestRedisUrl();
process.env.EMAIL_OUTBOX_DIR = TEST_OUTBOX_DIR;
