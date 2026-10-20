// `import type` is required (not just preferred): the e2e global setup runs
// migrations through plain Node, whose built-in TypeScript support does not
// elide value-imports that are only used as types (see AGENTS.md).
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Session management support: every refresh-token row journals the access
 * token minted for the same session.
 *
 * `accessJti`/`accessExpiresAt` let a targeted logout denylist exactly the
 * token that belongs to one device (and exactly for its remaining lifetime),
 * and let `GET /auth/sessions` mark the caller's own session.
 *
 * `expiresAt` indexes back the scheduled cleanup, which deletes rows a fixed
 * retention window after they expired.
 */
export class AddSessionAccessJournal1792449770853 implements MigrationInterface {
  name = 'AddSessionAccessJournal1792449770853';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD "accessJti" character varying(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD "accessExpiresAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_refresh_tokens_expires_at" ON "refresh_tokens" ("expiresAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_auth_tokens_expires_at" ON "auth_tokens" ("expiresAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_auth_tokens_expires_at"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_refresh_tokens_expires_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP COLUMN "accessExpiresAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP COLUMN "accessJti"`,
    );
  }
}
