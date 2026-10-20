// `import type` is required (not just preferred): the e2e global setup runs
// migrations through plain Node, whose built-in TypeScript support does not
// elide value-imports that are only used as types (see AGENTS.md).
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Session activity timestamp.
 *
 * `GET /auth/sessions` exposes `lastUsedAt`, and the login-time session cap
 * uses the same newest-first ordering. Existing rows are backfilled from
 * `createdAt` so no session appears older (or newer) than it really is.
 */
export class AddRefreshTokenLastUsedAt1792454000000 implements MigrationInterface {
  name = 'AddRefreshTokenLastUsedAt1792454000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD "lastUsedAt" timestamptz NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `UPDATE "refresh_tokens" SET "lastUsedAt" = "createdAt"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP COLUMN "lastUsedAt"`,
    );
  }
}
