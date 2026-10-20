// `import type` is required (not just preferred): the e2e global setup runs
// migrations through plain Node, whose built-in TypeScript support does not
// elide value-imports that are only used as types (see AGENTS.md).
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Forced password reset for restored accounts.
 *
 * A soft-deleted account keeps its password hash for a restore, but the old
 * credentials must not silently become valid again: every restore marks the
 * account and mails a reset link. The password-update tail clears the flag.
 * Existing accounts default to `false`, preserving normal login.
 */
export class AddPasswordResetRequired1792453000000 implements MigrationInterface {
  name = 'AddPasswordResetRequired1792453000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "passwordResetRequired" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "passwordResetRequired"`,
    );
  }
}
