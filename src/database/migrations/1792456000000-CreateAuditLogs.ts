// `import type` is required (not just preferred): the e2e global setup runs
// migrations through plain Node, whose built-in TypeScript support does not
// elide value-imports that are only used as types (see AGENTS.md).
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Append-only security audit trail.
 *
 * `actorUserId` is intentionally not a foreign key: records must survive user
 * deletion and never cascade away. The `(createdAt, id)` ordering backs the
 * default newest-first page; actor and action indexes make the admin filters
 * cheap.
 */
export class CreateAuditLogs1792456000000 implements MigrationInterface {
  name = 'CreateAuditLogs1792456000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "audit_logs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "actorUserId" uuid,
        "action" character varying(200) NOT NULL,
        "targetType" character varying(64),
        "targetId" character varying(128),
        "ip" character varying(64),
        "userAgent" character varying(512),
        "statusCode" integer NOT NULL,
        "success" boolean NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_logs" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_audit_logs_created_at" ON "audit_logs" ("createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_audit_logs_actor_user_id" ON "audit_logs" ("actorUserId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_audit_logs_action" ON "audit_logs" ("action")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "audit_logs"`);
  }
}
