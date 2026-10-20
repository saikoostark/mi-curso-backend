// `import type` is required (not just preferred): the e2e global setup runs
// migrations through plain Node, whose built-in TypeScript support does not
// elide value-imports that are only used as types (see AGENTS.md).
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuthorizationTables1792404464010 implements MigrationInterface {
  name = 'CreateAuthorizationTables1792404464010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "attributes" ("key" character varying(64) NOT NULL, "description" character varying(255) NOT NULL, "deprecatedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b478f4646843565d265c124fc3d" PRIMARY KEY ("key"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "groups" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" character varying(64) NOT NULL, "description" character varying(255), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_664ea405ae2a10c264d582ee563" UNIQUE ("name"), CONSTRAINT "PK_659d1483316afb28afd3a90646e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "group_attributes" ("groupId" uuid NOT NULL, "attributeKey" character varying(64) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ca93d0c18174a355ef4df50de23" PRIMARY KEY ("groupId", "attributeKey"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "user_attributes" ("userId" uuid NOT NULL, "attributeKey" character varying(64) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_51b64d4455e13066625376dacf0" PRIMARY KEY ("userId", "attributeKey"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "user_groups" ("userId" uuid NOT NULL, "groupId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_dc24675c437bf3c70d3d0dff67f" PRIMARY KEY ("userId", "groupId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_user_groups_group_id" ON "user_groups"  ("groupId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "group_attributes" ADD CONSTRAINT "FK_1625fea03d63c5ec0f6dcfb0509" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "group_attributes" ADD CONSTRAINT "FK_ebe5ed69f39f5f8ae2a9639316a" FOREIGN KEY ("attributeKey") REFERENCES "attributes"("key") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_attributes" ADD CONSTRAINT "FK_e49b58a79682836047c6158a72a" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_attributes" ADD CONSTRAINT "FK_22ca67ac5f5b051645acecd4647" FOREIGN KEY ("attributeKey") REFERENCES "attributes"("key") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_groups" ADD CONSTRAINT "FK_99d01ff7f143377c044f3d6c955" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_groups" ADD CONSTRAINT "FK_4dcea3f5c6f04650517d9dc4750" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_groups" DROP CONSTRAINT "FK_4dcea3f5c6f04650517d9dc4750"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_groups" DROP CONSTRAINT "FK_99d01ff7f143377c044f3d6c955"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_attributes" DROP CONSTRAINT "FK_22ca67ac5f5b051645acecd4647"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_attributes" DROP CONSTRAINT "FK_e49b58a79682836047c6158a72a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "group_attributes" DROP CONSTRAINT "FK_ebe5ed69f39f5f8ae2a9639316a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "group_attributes" DROP CONSTRAINT "FK_1625fea03d63c5ec0f6dcfb0509"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_user_groups_group_id"`);
    await queryRunner.query(`DROP TABLE "user_groups"`);
    await queryRunner.query(`DROP TABLE "user_attributes"`);
    await queryRunner.query(`DROP TABLE "group_attributes"`);
    await queryRunner.query(`DROP TABLE "groups"`);
    await queryRunner.query(`DROP TABLE "attributes"`);
  }
}
