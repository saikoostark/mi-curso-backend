import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { DataSource } from 'typeorm';
import { ATTRIBUTE_REGISTRY } from '../../identity/attributes/attribute-registry.js';
import type { AttributeDefinition } from '../../identity/attributes/define-attributes.js';
import { buildDataSourceOptions } from '../data-source-options.js';

/** Attribute row as stored in the database. */
interface AttributeRow {
  key: string;
  description: string;
  deprecatedAt: Date | null;
}

/** Catalog changes the generated migration must apply. */
interface AttributeDiff {
  inserts: AttributeDefinition[];
  updates: {
    key: string;
    description: string;
    previousDescription: string;
  }[];
  deprecations: { key: string }[];
}

/**
 * Diff-driven attribute seeding: `npm run db:migration:attributes -- script/Name`.
 *
 * Reads the declared catalog (`ATTRIBUTE_REGISTRY`, collected from every part
 * manifest) and the `attributes` table, then freezes the difference into a
 * regular migration file:
 * - declared keys missing from the table are **inserted**;
 * - keys whose description changed are **updated**;
 * - table keys no longer declared are **deprecated** (never deleted, so
 *   historical grants stay readable and a key can never change meaning).
 *
 * Migrations never import the live registry — this script is the only place
 * where the declared catalog and the database meet. The generated file has a
 * real `down()` and uses `import type` (required by the e2e migration runner,
 * see AGENTS.md).
 */
async function main(): Promise<void> {
  const target = process.argv[2];
  const url = process.env.DATABASE_URL;

  if (!target) {
    console.error(
      'Usage: npm run db:migration:attributes -- src/database/migrations/<Name>',
    );
    process.exitCode = 1;
    return;
  }

  if (!url) {
    console.error(
      'DATABASE_URL is not set — the db:* scripts load .env via --env-file.',
    );
    process.exitCode = 1;
    return;
  }

  const dataSource = new DataSource(buildDataSourceOptions(url));
  await dataSource.initialize();

  let rows: AttributeRow[] | null;
  try {
    rows = await readAttributeRows(dataSource);
  } finally {
    await dataSource.destroy();
  }

  if (rows === null) {
    console.warn(
      'Note: the "attributes" table does not exist yet — treating the catalog as empty (apply CreateAuthorizationTables first).',
    );
  }

  const diff = diffAttributes(rows ?? []);
  if (
    diff.inserts.length === 0 &&
    diff.updates.length === 0 &&
    diff.deprecations.length === 0
  ) {
    console.log('Attribute catalog is up to date — nothing to generate.');
    return;
  }

  const timestamp = Date.now();
  const name = basename(target).replace(/\.ts$/, '');
  const className = `${name}${timestamp}`;
  const filePath = join(dirname(target), `${timestamp}-${name}.ts`);

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, buildMigrationFile(className, diff), 'utf8');

  console.log(`Created ${filePath}`);
  console.log(
    `  inserts: ${diff.inserts.length}, description updates: ${diff.updates.length}, deprecations: ${diff.deprecations.length}`,
  );
}

/**
 * Reads the current catalog, distinguishing "table missing" from real errors.
 *
 * @param dataSource - Initialized data source.
 * @returns Catalog rows, or `null` when the table does not exist yet.
 */
async function readAttributeRows(
  dataSource: DataSource,
): Promise<AttributeRow[] | null> {
  try {
    return await dataSource.query<AttributeRow[]>(
      `SELECT "key", "description", "deprecatedAt" FROM "attributes"`,
    );
  } catch (error) {
    // 42P01 = "relation does not exist": before CreateAuthorizationTables has
    // ever run, every declared attribute simply counts as new.
    if ((error as { code?: string }).code === '42P01') {
      return null;
    }

    throw error;
  }
}

/**
 * Computes the difference between the declared catalog and the table.
 *
 * @param rows - Current catalog rows (empty when the table does not exist).
 * @returns Inserts, description updates and deprecations to freeze.
 */
function diffAttributes(rows: AttributeRow[]): AttributeDiff {
  const byKey = new Map(rows.map((row) => [row.key, row]));

  const inserts = ATTRIBUTE_REGISTRY.filter((def) => !byKey.has(def.key));

  const updates = ATTRIBUTE_REGISTRY.flatMap((def) => {
    const row = byKey.get(def.key);
    return row && row.description !== def.description
      ? [
          {
            key: def.key,
            description: def.description,
            previousDescription: row.description,
          },
        ]
      : [];
  });

  const deprecations = rows
    .filter(
      (row) =>
        row.deprecatedAt === null &&
        !ATTRIBUTE_REGISTRY.some((def) => def.key === row.key),
    )
    .map((row) => ({ key: row.key }));

  return { inserts, updates, deprecations };
}

/**
 * Renders the migration source file for a diff.
 *
 * @param className - Migration class name (`<Name><timestamp>`).
 * @param diff - Changes to freeze.
 * @returns Complete TypeScript source of the migration.
 */
function buildMigrationFile(className: string, diff: AttributeDiff): string {
  const up: string[] = [];
  const down: string[] = [];

  for (const def of diff.inserts) {
    up.push(
      queryStatement(
        `INSERT INTO "attributes" ("key", "description") VALUES ($1, $2)`,
        [def.key, def.description],
      ),
    );
    down.push(
      queryStatement(`DELETE FROM "attributes" WHERE "key" = $1`, [def.key]),
    );
  }

  for (const update of diff.updates) {
    up.push(
      queryStatement(
        `UPDATE "attributes" SET "description" = $1 WHERE "key" = $2`,
        [update.description, update.key],
      ),
    );
    down.push(
      queryStatement(
        `UPDATE "attributes" SET "description" = $1 WHERE "key" = $2`,
        [update.previousDescription, update.key],
      ),
    );
  }

  for (const deprecation of diff.deprecations) {
    up.push(
      queryStatement(
        `UPDATE "attributes" SET "deprecatedAt" = now() WHERE "key" = $1 AND "deprecatedAt" IS NULL`,
        [deprecation.key],
      ),
    );
    down.push(
      queryStatement(
        `UPDATE "attributes" SET "deprecatedAt" = NULL WHERE "key" = $1`,
        [deprecation.key],
      ),
    );
  }

  return `// Generated by \`npm run db:migration:attributes\` — do not edit by hand.
// \`import type\` is required (not just preferred): the e2e global setup runs
// migrations through plain Node, whose built-in TypeScript support does not
// elide value-imports that are only used as types (see AGENTS.md).
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Freezes the attribute-catalog changes that were pending when this migration
 * was generated (inserts, description updates, deprecations) so every
 * environment converges to the same catalog without importing the live
 * registry.
 */
export class ${className} implements MigrationInterface {
  name = '${className}';

  public async up(queryRunner: QueryRunner): Promise<void> {
${up.join('\n')}
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
${down.join('\n')}
  }
}
`;
}

/**
 * Renders one `queryRunner.query` statement with parameter literals.
 *
 * @param sql - SQL with `$n` placeholders.
 * @param params - Placeholder values.
 * @returns Indented TypeScript statement.
 */
function queryStatement(sql: string, params: string[]): string {
  const values = params.map((value) => JSON.stringify(value)).join(', ');
  return `    await queryRunner.query(\n      \`${sql}\`,\n      [${values}],\n    );`;
}

await main();
