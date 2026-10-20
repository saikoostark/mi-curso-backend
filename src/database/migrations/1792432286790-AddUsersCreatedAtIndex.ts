// `import type` is required (not just preferred): the e2e global setup runs
// migrations through plain Node, whose built-in TypeScript support does not
// elide value-imports that are only used as types (see AGENTS.md).
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Index for the deterministic paged user list.
 *
 * Postgres can scan a `(createdAt, id)` btree backwards to satisfy
 * `ORDER BY createdAt DESC, id DESC`, so the same index also supports the
 * reverse ordering without a second structure.
 */
export class AddUsersCreatedAtIndex1792432286790 implements MigrationInterface {
  name = 'AddUsersCreatedAtIndex1792432286790';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "idx_users_created_at_id" ON "users" ("createdAt", "id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_users_created_at_id"`);
  }
}
