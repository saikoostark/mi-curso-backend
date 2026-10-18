# Agent Guidelines (AGENTS.md)

Backend for a courses/e-learning application, built incrementally feature by feature. NestJS 12, ESM, Vitest, oxlint — details below.

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

## Testing conventions
- Both configs set `globals: true`: use `describe/it/expect` without imports.
- Unit specs live next to their source in `src/` and build modules with `Test.createTestingModule`; mock external dependencies.
- E2E specs live in `test/` and use supertest (`import request from 'supertest'`; `App` type from `supertest/types.js`).
- Integration tests should wire real modules together rather than mocking the app under test.

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
- `@nestjs/config` is not installed yet and there is no `.env`; `main.ts` reads `process.env.PORT` directly. Install `@nestjs/config` before introducing `ConfigModule`; keep `.env` gitignored.
