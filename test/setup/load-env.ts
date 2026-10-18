/**
 * Setup file for e2e runs (executed in every worker before test files load).
 *
 * Loads `.env` and redirects the application to the dedicated test database
 * (`DATABASE_URL_TEST`). Configuration mistakes (missing or non-dedicated test
 * database) are caught earlier, in the Vitest global setup.
 */
import { getTestDatabaseUrl, loadDotEnvFile } from './env.js';

loadDotEnvFile();

// Point the application (booted inside this worker) at the test database.
process.env.DATABASE_URL = getTestDatabaseUrl();
