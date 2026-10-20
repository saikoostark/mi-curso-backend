import { QueryFailedError } from 'typeorm';

/**
 * Minimal shape of the underlying PostgreSQL driver error.
 *
 * `constraint` is only present when the failed constraint has a name; both the
 * unique constraints and the partial unique indexes introduced by migrations
 * are named, so it is reliable for the cases this project cares about.
 */
interface PostgresError {
  code?: string;
  constraint?: string;
}

/**
 * Extracts the violated constraint name from a unique-violation error.
 *
 * Race-safe uniqueness is enforced by the database, but the resulting
 * `QueryFailedError` must be translated back into a domain conflict before it
 * reaches the HTTP layer, otherwise it becomes a generic 500. This helper is
 * the single place that knows how TypeORM exposes the Postgres `23505` code.
 *
 * @param error - Error thrown by a repository write.
 * @returns The constraint name, or `null` when the error is not a known
 * unique violation.
 */
export function uniqueViolationConstraint(error: unknown): string | null {
  const driverError = postgresError(error);

  if (driverError?.code !== '23505' || !driverError.constraint) {
    return null;
  }

  return driverError.constraint;
}

/** Pulls the driver error out of `QueryFailedError` (with a raw fallback). */
function postgresError(error: unknown): PostgresError | null {
  if (error instanceof QueryFailedError) {
    const driver = (error as QueryFailedError & { driverError?: unknown })
      .driverError;
    if (driver && typeof driver === 'object') {
      return driver as PostgresError;
    }

    return null;
  }

  if (error && typeof error === 'object' && 'code' in error) {
    return error as PostgresError;
  }

  return null;
}
