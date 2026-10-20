// `import type` is required (not just preferred): the e2e global setup runs
// migrations through plain Node, whose built-in TypeScript support does not
// elide value-imports that are only used as types (see AGENTS.md).
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SplitUserProfiles1792426979556 implements MigrationInterface {
  name = 'SplitUserProfiles1792426979556';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "user_profiles" ("userId" uuid NOT NULL, "firstName" character varying(100), "lastName" character varying(100), "phone" character varying(20), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_user_profiles" PRIMARY KEY ("userId"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_profiles" ADD CONSTRAINT "FK_user_profiles_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    // Every existing account gets its profile row, preserving the current data.
    await queryRunner.query(
      `INSERT INTO "user_profiles" ("userId", "firstName", "lastName", "phone", "createdAt", "updatedAt")
       SELECT "id", "firstName", "lastName", "phone", "createdAt", "updatedAt" FROM "users"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "firstName"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "lastName"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "phone"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "firstName" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "lastName" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "phone" character varying(20)`,
    );
    await queryRunner.query(
      `UPDATE "users" SET "firstName" = "user_profiles"."firstName", "lastName" = "user_profiles"."lastName", "phone" = "user_profiles"."phone"
       FROM "user_profiles" WHERE "user_profiles"."userId" = "users"."id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_profiles" DROP CONSTRAINT "FK_user_profiles_userId"`,
    );
    await queryRunner.query(`DROP TABLE "user_profiles"`);
  }
}
