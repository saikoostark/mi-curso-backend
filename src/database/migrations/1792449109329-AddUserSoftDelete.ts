// `import type` is required (not just preferred): the e2e global setup runs
// migrations through plain Node, whose built-in TypeScript support does not
// elide value-imports that are only used as types (see AGENTS.md).
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Soft deletion for user accounts.
 *
 * `users.deletedAt` marks an account as deleted while the row survives, so an
 * admin can restore it (grants and memberships are kept implicitly). The
 * original global UNIQUE constraints on `email`/`username` are replaced by
 * **partial** unique indexes that only cover active rows: a deleted account's
 * identifiers can be reused by a new registration immediately, and the restore
 * flow resolves any collision explicitly.
 *
 * The `down` path can fail when deleted and active accounts now share an
 * identifier — reconciling that is a manual decision, not something a
 * migration may resolve.
 */
export class AddUserSoftDelete1792449109329 implements MigrationInterface {
  name = 'AddUserSoftDelete1792449109329';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "deletedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "UQ_fe0bb3f6520ee0469504521e710"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_users_email_active" ON "users" ("email") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_users_username_active" ON "users" ("username") WHERE "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."uq_users_username_active"`);
    await queryRunner.query(`DROP INDEX "public"."uq_users_email_active"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_fe0bb3f6520ee0469504521e710" UNIQUE ("username")`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email")`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "deletedAt"`);
  }
}
