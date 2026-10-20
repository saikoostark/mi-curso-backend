import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { DataSource } from 'typeorm';
import { hashPassword } from '../../src/identity/password/password.util.js';

/** Fields for a directly seeded (verified) account. */
export interface SeedUserInput {
  email: string;
  username: string;
  password: string;
  isSuperuser?: boolean;
}

/**
 * Wipes everything the authorization e2e specs touch.
 *
 * The seeded `attributes` catalog is deliberately left alone: migrations own
 * it and specs only assert against it. Cascades remove the grants
 * (`user_attributes`), memberships (`user_groups`), token rows and the audit
 * trail written while setting up/tearing down the previous test.
 *
 * @param dataSource - Application data source (test database).
 */
export async function truncateForAuthorization(
  dataSource: DataSource,
): Promise<void> {
  await dataSource.query(
    'TRUNCATE TABLE audit_logs, refresh_tokens, auth_tokens, groups, users CASCADE',
  );
}

/**
 * Seeds a verified account directly in the database (no email flow) so specs
 * can start from a known state; the API path is exercised by the specs
 * themselves.
 *
 * @param dataSource - Application data source (test database).
 * @param input - Email/username/password and the superuser flag.
 * @returns The new user's id.
 */
export async function seedVerifiedUser(
  dataSource: DataSource,
  input: SeedUserInput,
): Promise<string> {
  const passwordHash = await hashPassword(input.password);
  const rows = await dataSource.query<{ id: string }[]>(
    `INSERT INTO "users" ("email", "username", "passwordHash", "emailVerifiedAt", "isSuperuser")
     VALUES ($1, $2, $3, now(), $4)
     RETURNING "id"`,
    [input.email, input.username, passwordHash, input.isSuperuser ?? false],
  );

  // Accounts and profiles are born together; the profile row is all-null here.
  await dataSource.query(`INSERT INTO "user_profiles" ("userId") VALUES ($1)`, [
    rows[0].id,
  ]);

  return rows[0].id;
}

/**
 * Inserts direct attribute grants for a user (setup only — grant semantics are
 * exercised through the API in the specs).
 *
 * @param dataSource - Application data source (test database).
 * @param userId - Target user.
 * @param keys - Attribute keys to grant.
 */
export async function grantAttributesDirectly(
  dataSource: DataSource,
  userId: string,
  keys: string[],
): Promise<void> {
  for (const key of keys) {
    await dataSource.query(
      `INSERT INTO "user_attributes" ("userId", "attributeKey") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, key],
    );
  }
}

/**
 * Logs a seeded account in and returns its access token.
 *
 * @param app - Initialized e2e application.
 * @param identifier - Email or username.
 * @param password - Plain-text password.
 * @returns The access token for `Authorization: Bearer`.
 */
export async function loginForToken(
  app: INestApplication<App>,
  identifier: string,
  password: string,
): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ identifier, password });

  if (response.status !== 200) {
    throw new Error(
      `loginForToken failed for ${identifier}: ${response.status} ${JSON.stringify(response.body)}`,
    );
  }

  return response.body.data.accessToken as string;
}

/**
 * Builds a Bearer header for supertest requests.
 *
 * @param token - Access token.
 * @returns Header record.
 */
export function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}
