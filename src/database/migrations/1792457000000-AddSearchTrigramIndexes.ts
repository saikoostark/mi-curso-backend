// `import type` is required (not just preferred): the e2e global setup runs
// migrations through plain Node, whose built-in TypeScript support does not
// elide value-imports that are only used as types (see AGENTS.md).
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Trigram indexes for the case-insensitive substring searches.
 *
 * `GET /users?search=` matches `%term%` across account and profile columns, and
 * `GET /audit-logs?action=` does the same on the audit action. A btree cannot
 * serve leading-wildcard LIKE/ILIKE predicates; `pg_trgm` GIN indexes can.
 * The extension itself is shared infrastructure and is deliberately not
 * dropped on revert.
 */
export class AddSearchTrigramIndexes1792457000000 implements MigrationInterface {
  name = 'AddSearchTrigramIndexes1792457000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    await queryRunner.query(
      `CREATE INDEX "idx_users_email_trgm" ON "users" USING gin ("email" gin_trgm_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_users_username_trgm" ON "users" USING gin ("username" gin_trgm_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_user_profiles_first_name_trgm" ON "user_profiles" USING gin ("firstName" gin_trgm_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_user_profiles_last_name_trgm" ON "user_profiles" USING gin ("lastName" gin_trgm_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_audit_logs_action_trgm" ON "audit_logs" USING gin ("action" gin_trgm_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_audit_logs_target" ON "audit_logs" ("targetType", "targetId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_audit_logs_success_created_at" ON "audit_logs" ("success", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_audit_logs_success_created_at"`);
    await queryRunner.query(`DROP INDEX "idx_audit_logs_target"`);
    await queryRunner.query(`DROP INDEX "idx_audit_logs_action_trgm"`);
    await queryRunner.query(`DROP INDEX "idx_user_profiles_last_name_trgm"`);
    await queryRunner.query(`DROP INDEX "idx_user_profiles_first_name_trgm"`);
    await queryRunner.query(`DROP INDEX "idx_users_username_trgm"`);
    await queryRunner.query(`DROP INDEX "idx_users_email_trgm"`);
  }
}
