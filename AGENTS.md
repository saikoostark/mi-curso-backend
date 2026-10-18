# Agent Guidelines (AGENTS.md)

Backend for a courses/e-learning application, built incrementally feature by feature. NestJS 12, ESM, Vitest, oxlint, Postgres 18 + TypeORM — details below.

## ESM project — relative imports need `.js` extensions
- `package.json` sets `"type": "module"`; tsconfig uses `module`/`moduleResolution: "nodenext"`.
- Every relative import must end in `.js` even though sources are `.ts`: `import { AppService } from './app.service.js'`.
- `nest g` schematics already emit `.js`; hand-written imports must match or Node throws `ERR_MODULE_NOT_FOUND`.

## Toolchain differs from NestJS defaults
- Tests use **Vitest**, not Jest: unit `**/*.spec.ts`, e2e `**/*.e2e-spec.ts`.
- Lint uses **oxlint** (`oxlint --type-aware src/ test/`), not ESLint. `typescript/no-floating-promises` is an error; `typescript/no-explicit-any` is off.
- Prettier (single quotes, trailing commas) runs via `npm run format` and covers only `src/**` and `test/**`.
- Vitest prints a `vite-tsconfig-paths` migration nudge — harmless, ignore it.

## Commands
- Dev server: `npm run start:dev` (watch; port from `PORT` env or 3000). Check if an instance is already running before starting another.
- Build/production: `npm run build`, then `npm run start:prod` (`node dist/main`).
- Single unit test: `npx vitest run src/app.controller.spec.ts`.
- Single e2e test: `npx vitest run --config ./vitest.config.e2e.ts test/app.e2e-spec.ts`.
- No dedicated typecheck script; `npm run build` (tsc via `tsconfig.build.json`) and type-aware lint are the checks.
- Migrations (TypeORM CLI via `tsx`; the scripts load `.env` with `node --env-file=.env` and fail loudly when it is missing):
  - `npm run db:migration:create -- src/database/migrations/Name` — empty migration.
  - `npm run db:migration:generate -- src/database/migrations/Name` — diff entities against the DB.
  - `npm run db:migration:run` / `npm run db:migration:revert`.
- `npm run test:e2e` requires `.env` and a reachable Postgres; specs run against the dedicated `DATABASE_URL_TEST` database (created manually — see Infrastructure) with pending migrations applied first.

## Testing conventions
- Both configs set `globals: true`: use `describe/it/expect` without imports.
- Unit specs live next to their source in `src/` and build modules with `Test.createTestingModule`; mock external dependencies.
- E2E specs live in `test/` and use supertest (`import request from 'supertest'`; `App` type from `supertest/types.js`).
- Integration tests should wire real modules together rather than mocking the app under test.
- E2E runs boot the app against the dedicated test database: `test/setup/global-setup.ts` refuses to run when `DATABASE_URL_TEST` matches `DATABASE_URL` (tests truncate data) and applies pending migrations to it first; `test/setup/load-env.ts` then redirects the application to it in every worker. Nothing creates databases — `DATABASE_URL_TEST` must already exist.
- E2E specs truncate the data they touch; the test database is disposable and developer data lives in `DATABASE_URL`. A health spec asserts the app really is connected to the test DB.

## Infrastructure — Postgres + TypeORM
- Postgres 18 runs in the user's Docker container (localhost:5432). Databases are picked via env: `DATABASE_URL` for the app, `DATABASE_URL_TEST` for e2e (dedicated + disposable); nothing auto-creates databases — create them manually.
- Wiring lives in `src/database/`: `data-source-options.ts` holds side-effect-free option builders (safe for the app to import), `data-source.ts` is the CLI-only entry point (`-d src/database/data-source.ts`), and `database.module.ts` registers `TypeOrmModule.forRootAsync` from `DATABASE_URL`. Feature modules own entities via `TypeOrmModule.forFeature` and inject repositories.
- `synchronize` is always `false`; the schema changes only through migrations in `src/database/migrations/` (tracking table: `typeorm_migrations`). CLI entity/migration globs target `src/**` TypeScript sources because the CLI runs through `tsx`.
- ESM entity gotchas (TypeORM 1.x): relation properties need the `Relation<T>` wrapper; legacy APIs (`Connection`, `findByIds`, `findOneById`) are gone.
- `GET /health` runs `SELECT 1` (200/503). It will be replaced by `@nestjs/terminus` when the Redis cache lands.
- Decided, not yet wired (all additive, no rework for what exists): Redis cache via `@nestjs/cache-manager` + `cache-manager` 7 + `@keyv/redis` behind an own `CacheService` (TTLs in **milliseconds**, JSON-only values, pin keyv 5.x, attach an error listener); logging via `nestjs-pino` (`@nestjs/core` >= 12.0.2); `@nestjs/terminus` health; OpenTelemetry + Grafana stack at deploy (ESM needs `--experimental-loader=@opentelemetry/instrumentation/hook.mjs` plus `--import`).

## Architecture & style
- Keep each feature in its own NestJS module (controller → service → provider); apply SOLID without overengineering.
- Document every function/module/class created: JSDoc/TSDoc for public APIs, inline comments for non-obvious logic.
- Keep naming, folder layout, and patterns deterministic so new code follows the established structure.

## Dependency decisions — user picks before install
- When implementing logic a package could handle, do not choose silently: first present the options in chat.
- Each option gets pros and cons, and the list must always include the native (no-dependency) approach.
- Wait for the user's choice before installing anything or writing the implementation.

## Security & configuration
- Never hardcode secrets, API keys, credentials, or URLs.
- `@nestjs/config` is wired globally (`ConfigModule.forRoot({ isGlobal: true })` in `AppModule`) and loads `.env` when `AppModule` is imported; `main.ts` keeps reading `process.env.PORT` directly, which is loaded before `listen` runs.
- Real credentials live only in the gitignored `.env`; `.env.example` is the committed template (`DATABASE_URL`, `DATABASE_URL_TEST`, `PORT`). CLI scripts load `.env` explicitly via `node --env-file=.env`; test setup files use Node's native `process.loadEnvFile()`.
