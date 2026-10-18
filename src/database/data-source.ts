import { DataSource } from 'typeorm';
import { buildCliDataSourceOptions } from './data-source-options.js';

/**
 * Reads a required environment variable or fails fast with a clear message.
 *
 * @param name - Name of the environment variable to read.
 * @returns The variable's value.
 */
function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `Environment variable ${name} is not set — copy .env.example to .env (see AGENTS.md).`,
    );
  }

  return value;
}

/**
 * Entry point the TypeORM CLI connects with (`-d src/database/data-source.ts`).
 *
 * Kept separate from `data-source-options.ts` so that importing the option
 * builders never evaluates this module: the application would otherwise read
 * `DATABASE_URL` before `ConfigModule` has loaded `.env`.
 *
 * The `db:*` scripts pass `--env-file=.env`, so `DATABASE_URL` is already
 * loaded by the time this module is evaluated.
 */
export default new DataSource(
  buildCliDataSourceOptions(requireEnv('DATABASE_URL')),
);
