// `import type` is required (not just preferred): the e2e global setup runs
// migrations through plain Node, whose built-in TypeScript support does not
// elide value-imports that are only used as types (see AGENTS.md).
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pending two-sided email changes.
 *
 * A verified account that wants a new address stores it here while the
 * approval link goes to the *current* address. The unique index on `userId`
 * enforces one pending change per account; `expiresAt` backs both the approval
 * check and the scheduled cleanup. The cascade removes the request when the
 * account is hard-deleted (soft deletion purges it explicitly).
 */
export class AddEmailChangeRequests1792450836303 implements MigrationInterface {
  name = 'AddEmailChangeRequests1792450836303';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "email_change_requests" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "userId" uuid NOT NULL, "newEmail" character varying(254) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_email_change_requests" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_email_change_requests_user_id" ON "email_change_requests" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_email_change_requests_expires_at" ON "email_change_requests" ("expiresAt")`,
    );
    await queryRunner.query(
      `ALTER TABLE "email_change_requests" ADD CONSTRAINT "FK_email_change_requests_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "email_change_requests" DROP CONSTRAINT "FK_email_change_requests_user"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_email_change_requests_expires_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_email_change_requests_user_id"`,
    );
    await queryRunner.query(`DROP TABLE "email_change_requests"`);
  }
}
