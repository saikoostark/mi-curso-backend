# MiCurso Backend

Backend API for **MiCurso**, a courses/e-learning platform. It provides the
identity, authorization, administration, audit and operational foundation for
the product.

The current milestone covers accounts and authentication, attribute/group-based
authorization, admin management, audit logging, caching, rate limiting and
health/metrics endpoints. Course catalog, lessons and enrollment modules are the
next domain layer.

## Stack

| Layer                 | Technology                                                |
| --------------------- | --------------------------------------------------------- |
| Runtime               | Node.js 24+, TypeScript, ESM                              |
| Framework             | NestJS 12                                                 |
| Database              | PostgreSQL 18 + TypeORM (migrations only, no synchronize) |
| Cache / rate limiting | Redis 8                                                   |
| API documentation     | Swagger / OpenAPI at `/docs`                              |
| Authentication        | JWT access tokens + rotating refresh cookies              |
| Password hashing      | scrypt                                                    |
| Logging               | nestjs-pino                                               |
| Tests                 | Vitest + Supertest                                        |
| Linting / formatting  | oxlint + Prettier                                         |

## Features

### Identity and accounts

- Registration with email verification.
- Login by email or username.
- Short-lived access tokens and rotating refresh tokens.
- Refresh-token reuse detection, per-token revocation and logout from all devices.
- Active-session listing, per-session revocation and a configurable session cap.
- Profile editing, password change and self-service account deletion.
- Two-sided email change: approval from the current address, then verification
  of the new address.
- Password recovery with single-use reset tokens.
- Rate limiting on login, registration, verification resend, password-recovery
  requests and email-change flows.
- scrypt password hashing and constant-cost login for unknown accounts.

### Authorization and administration

- Concrete `module:action` attributes such as `users:read` and `groups:manage_members`.
- Direct user grants and group-derived grants; superusers hold the full catalog.
- Attribute-based capability guards on user and group management routes.
- Admin user management: create, list, inspect, update, soft-delete, restore,
  grant/revoke attributes.
- Admin group management: CRUD, membership and group attributes.
- Paginated user and audit-log listings with filters and whitelisted sorting.
- Search indexes backed by PostgreSQL `pg_trgm`.

### Operations

- `GET /health` — liveness only; no dependency checks.
- `GET /ready` — Postgres and Redis readiness; `503` when either is down.
- `GET /metrics` — native JSON process and dependency telemetry; optionally
  protected by `METRICS_TOKEN`.
- Global audit trail for mutating HTTP requests.
- Structured HTTP logging with cookie/authorization redaction.
- Swagger UI and OpenAPI JSON.
- Graceful shutdown for HTTP, Postgres and Redis.

## Quick start

### Prerequisites

- Node.js 24+
- PostgreSQL 18, reachable from the application
- Redis 8, reachable from the application
- Two PostgreSQL databases for local work:
  - `micurso_dev` — application data
  - `micurso_test` — disposable database for e2e tests
- Two Redis logical databases:
  - `/0` — application cache, access-token denylist and rate-limit state
  - `/1` — disposable e2e state

Nothing in the application creates databases. Create them with your Postgres
client or container tooling first.

### 1. Clone and install

```bash
git clone https://github.com/saikoostark/mi-curso-backend.git
cd mi-curso-backend
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

On PowerShell:

```powershell
Copy-Item .env.example .env
```

Set at least `DATABASE_URL`, `REDIS_URL` and `JWT_SECRET`. Generate a secret
with:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

The test URLs must point at dedicated targets; the e2e setup refuses to run if
they match the development database or Redis database.

### 3. Create databases

If `createdb` is available locally:

```bash
createdb micurso_dev
createdb micurso_test
```

If Postgres runs in Docker, run the equivalent command through
`docker exec` or your SQL client.

### 4. Apply migrations

```bash
npm run db:migration:run
```

Migrations create the schema, seed the attribute catalog and install the search
indexes. The test database is migrated automatically by the e2e global setup.

### 5. Bootstrap a superuser

```bash
npm run create-superuser
```

The command is interactive, validates the same password policy as registration
and creates a verified superuser. To automate it, pipe one answer per line:
username, email, password, password confirmation.

### 6. Start the API

```bash
npm run start:dev
```

The API listens on `PORT` (default `3000`).

- Swagger UI: <http://localhost:3000/docs>
- OpenAPI JSON: <http://localhost:3000/docs-json>
- Health: <http://localhost:3000/health>
- Readiness: <http://localhost:3000/ready>

## Environment variables

| Variable                   | Required | Default            | Purpose                                                           |
| -------------------------- | -------- | ------------------ | ----------------------------------------------------------------- |
| `DATABASE_URL`             | Yes      | —                  | Application PostgreSQL connection                                 |
| `DATABASE_URL_TEST`        | E2E only | —                  | Dedicated test database; must differ from `DATABASE_URL`          |
| `REDIS_URL`                | Yes      | —                  | Application Redis URL, including logical DB and optional password |
| `REDIS_URL_TEST`           | E2E only | —                  | Dedicated test Redis logical DB; must differ from `REDIS_URL`     |
| `JWT_SECRET`               | Yes      | —                  | Access-token signing secret                                       |
| `JWT_SECRET_PREVIOUS`      | No       | —                  | Previous secret accepted during key rotation                      |
| `JWT_ISSUER`               | No       | `micurso`          | Access-token issuer claim                                         |
| `JWT_AUDIENCE`             | No       | `micurso-api`      | Access-token audience claim                                       |
| `MAX_ACTIVE_SESSIONS`      | No       | `10`               | Maximum active refresh sessions per account                       |
| `CORS_ORIGINS`             | No       | —                  | Comma-separated browser origin allowlist; `*` is rejected         |
| `APP_URL`                  | Yes      | —                  | Base URL used in verification, reset and approval links           |
| `EMAIL_OUTBOX_DIR`         | No       | `var/email-outbox` | File-based development email outbox                               |
| `TRUST_PROXY`              | No       | —                  | Express trust-proxy setting; only set behind a known proxy        |
| `AUTH_DENYLIST_MAX_SIZE`   | No       | `100000`           | Cap for live JWT denylist entries                                 |
| `AUTH_CLEANUP_INTERVAL_MS` | No       | `300000`           | Token, denylist and audit cleanup interval                        |
| `AUDIT_LOG_RETENTION_DAYS` | No       | `365`              | Audit-row retention                                               |
| `METRICS_TOKEN`            | No       | —                  | Bearer token required by `/metrics` when set                      |
| `PORT`                     | No       | `3000`             | HTTP port                                                         |

Redis credentials belong in the URL:

```text
redis://:password@localhost:6379/0
```

## Commands

| Command                                                           | Description                                  |
| ----------------------------------------------------------------- | -------------------------------------------- |
| `npm run start:dev`                                               | Start in watch mode                          |
| `npm run start`                                                   | Start without watch mode                     |
| `npm run build`                                                   | Compile to `dist/`                           |
| `npm run start:prod`                                              | Run the compiled build                       |
| `npm run lint`                                                    | Type-aware oxlint check                      |
| `npm run format`                                                  | Format `src/` and `test/` with Prettier      |
| `npx tsc --noEmit`                                                | Typecheck without emitting                   |
| `npm test`                                                        | Unit tests                                   |
| `npm run test:watch`                                              | Unit tests in watch mode                     |
| `npm run test:cov`                                                | Unit tests with coverage                     |
| `npm run test:e2e`                                                | Full e2e suite                               |
| `npm run db:migration:create -- src/database/migrations/Name`     | Create an empty migration                    |
| `npm run db:migration:generate -- src/database/migrations/Name`   | Generate a migration from entity changes     |
| `npm run db:migration:run`                                        | Apply pending migrations                     |
| `npm run db:migration:revert`                                     | Revert the last migration                    |
| `npm run db:migration:attributes -- src/database/migrations/Name` | Generate an attribute-catalog seed migration |
| `npm run create-superuser`                                        | Bootstrap a verified superuser               |

Single test examples:

```bash
npx vitest run src/app.controller.spec.ts
npx vitest run --config ./vitest.config.e2e.ts test/auth.e2e-spec.ts
```

## API

All application responses use a consistent envelope.

### Success

```json
{
  "success": true,
  "data": {}
}
```

Paged endpoints return the list under `data.page`:

```json
{
  "success": true,
  "data": {
    "page": [],
    "pagination": {
      "page": 1,
      "limit": 25,
      "total": 0,
      "totalPages": 0,
      "hasNext": false,
      "hasPrevious": false
    }
  }
}
```

### Errors

```json
{
  "success": false,
  "error": {
    "code": "invalid_credentials",
    "message": "Invalid email/username or password."
  }
}
```

Validation errors add `details`; domain-specific context is returned in `meta`.
Infrastructure routes (`/health`, `/ready`, `/metrics`, `/`) opt out of the
envelope.

### Authentication

| Method   | Path                         | Access                         | Description                                                 |
| -------- | ---------------------------- | ------------------------------ | ----------------------------------------------------------- |
| `POST`   | `/auth/register`             | Public                         | Register an account                                         |
| `GET`    | `/auth/verify-email?token=`  | Public                         | Consume a verification link                                 |
| `POST`   | `/auth/resend-verification`  | Public                         | Request a new verification link                             |
| `POST`   | `/auth/login`                | Public                         | Log in; returns an access token and sets the refresh cookie |
| `POST`   | `/auth/refresh`              | Refresh cookie                 | Rotate the refresh token                                    |
| `POST`   | `/auth/logout`               | Bearer                         | Log out of all devices                                      |
| `POST`   | `/auth/logout/current`       | Access token or refresh cookie | Log out the current session                                 |
| `POST`   | `/auth/logout/others`        | Bearer                         | Log out every other session                                 |
| `GET`    | `/auth/sessions`             | Bearer                         | List active refresh sessions                                |
| `DELETE` | `/auth/sessions/:id`         | Bearer                         | Revoke one session                                          |
| `GET`    | `/auth/me`                   | Bearer                         | Current user and profile                                    |
| `PATCH`  | `/auth/me`                   | Bearer                         | Update the current profile                                  |
| `PATCH`  | `/auth/password`             | Bearer                         | Change the password; revokes all sessions                   |
| `POST`   | `/auth/delete-account`       | Bearer                         | Soft-delete the current account                             |
| `GET`    | `/auth/email`                | Bearer                         | Read the pending email change                               |
| `POST`   | `/auth/email`                | Bearer                         | Request an email change                                     |
| `DELETE` | `/auth/email`                | Bearer                         | Cancel a pending email change                               |
| `GET`    | `/auth/email/approve?token=` | Public                         | Preview an email-change approval                            |
| `POST`   | `/auth/email/approve`        | Public                         | Apply an email change with `{ "token": "..." }`             |
| `POST`   | `/auth/forgot-password`      | Public                         | Request a password-reset link                               |
| `POST`   | `/auth/reset-password`       | Public                         | Reset the password with a token                             |

Access tokens are returned in the JSON body and should be kept in memory. The
refresh token lives in an `httpOnly`, `SameSite=Strict` cookie scoped to
`/auth`; `Secure` is enabled in production. Rotating a refresh token invalidates
the old one; reusing a rotated token is treated as theft and revokes all of the
user's sessions.

### Administration

All routes require a bearer access token. User and group management routes
additionally require their concrete attribute; `GET /attributes` is available to
any authenticated user, and superusers bypass individual checks.

| Method           | Path                          | Capability                      | Description                       |
| ---------------- | ----------------------------- | ------------------------------- | --------------------------------- |
| `GET`            | `/users`                      | `users:read`                    | Paginated user list               |
| `POST`           | `/users`                      | `users:create`                  | Create a user                     |
| `GET`            | `/users/:id`                  | `users:read`                    | Read a user                       |
| `PATCH`          | `/users/:id`                  | `users:update`                  | Update account/profile            |
| `DELETE`         | `/users/:id`                  | `users:delete`                  | Soft-delete a user                |
| `POST`           | `/users/:id/restore`          | `users:update`                  | Restore a deleted user            |
| `PUT` / `DELETE` | `/users/:id/attributes/:key`  | `users:assign_attributes`       | Grant/revoke an attribute         |
| `GET` / `POST`   | `/groups`                     | `groups:read` / `groups:create` | List/create groups                |
| `GET`            | `/groups/:id`                 | `groups:read`                   | Read a group                      |
| `PATCH`          | `/groups/:id`                 | `groups:update`                 | Update a group                    |
| `DELETE`         | `/groups/:id`                 | `groups:delete`                 | Delete a group                    |
| `PUT` / `DELETE` | `/groups/:id/attributes/:key` | `groups:manage_attributes`      | Grant/revoke a group attribute    |
| `PUT` / `DELETE` | `/groups/:id/members/:userId` | `groups:manage_members`         | Add/remove a member               |
| `GET`            | `/attributes`                 | Any authenticated user          | Read the attribute catalog        |
| `GET`            | `/audit-logs`                 | `audit:read`                    | Paginated, filterable audit trail |

`GET /users` supports `page`, `limit`, `status=active|deleted|all`, `search`,
`emailVerified`, `isSuperuser`, `sort=createdAt|email|username` and
`order=asc|desc`. `GET /audit-logs` supports filters for action, actor, target,
success and date range.

### Operations

| Method | Path       | Description                                                                      |
| ------ | ---------- | -------------------------------------------------------------------------------- |
| `GET`  | `/health`  | Liveness probe; returns `200 { "status": "ok" }`                                 |
| `GET`  | `/ready`   | Postgres and Redis readiness; `503` when a dependency is down                    |
| `GET`  | `/metrics` | JSON telemetry; requires `Authorization: Bearer <METRICS_TOKEN>` when configured |

### First request walkthrough

Register a user:

```bash
curl -s -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "username": "admin",
    "password": "Str0ngPassw0rd",
    "passwordConfirm": "Str0ngPassw0rd"
  }'
```

The verification email is written to the development outbox:

```text
var/email-outbox/outbox.jsonl
var/email-outbox/*.txt
```

Open the verification link from the message, then log in:

```bash
curl -i -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifier":"admin@example.com","password":"Str0ngPassw0rd"}'
```

Use the returned `data.accessToken` as `Authorization: Bearer <token>`. The
response also sets the refresh cookie for `/auth`.

## Architecture

```text
src/
  admin/        Admin use cases, controllers, capability guards and policies
  audit/        Append-only audit entity, service and global interceptor
  cache/        CacheService port and Redis adapter
  common/       Response envelope, pagination, errors and Swagger setup
  database/     TypeORM options, migrations and CLI scripts
  email/        EmailService port and file-outbox adapter
  health/       Liveness, readiness and metrics endpoints
  identity/     Users, auth journeys, tokens, passwords, attributes and groups
  rate-limit/   RateLimiter port and fixed-window Redis adapter
test/           E2E suites and shared test infrastructure
```

Key boundaries:

- `identity/` owns authentication, account/profile primitives and the shared
  authorization engine.
- `admin/` owns management use cases; it composes `IdentityModule` and never
  flows back into it.
- `audit/` is global and records every mutating request without storing bodies,
  query strings or cookies.
- `common/` contains only genuinely cross-module HTTP/Swagger utilities.
- Feature modules own their entities and repositories via `TypeOrmModule.forFeature`.

## Testing

Unit tests live next to their source and mock external dependencies. E2E tests
live under `test/` and boot the real application against the dedicated test
database and Redis logical DB.

The e2e setup:

- refuses to run when `DATABASE_URL_TEST` or `REDIS_URL_TEST` equals the
  development target;
- applies pending migrations;
- pings Redis;
- clears the test email outbox;
- truncates only the tables used by each spec.

E2E files run **sequentially** because they share and truncate the same test
database. The suite uses 30-second test/hook timeouts because authentication
flows run scrypt hashes and several sequential HTTP requests. Do not run unit
and e2e suites concurrently during normal verification.

The test database and Redis logical DB are disposable. Developer data belongs
in `DATABASE_URL` / `REDIS_URL`.

## Security and operations

- `.env` is gitignored. Never commit real database URLs, Redis passwords or JWT
  secrets.
- Access tokens are short-lived; refresh tokens rotate and are stored only as
  SHA-256 hashes.
- Password changes, resets and account deletion revoke all sessions.
- `CORS_ORIGINS` is an explicit allowlist because credential-bearing requests
  are enabled. `*` is rejected at boot.
- Set `TRUST_PROXY` only when the API is behind a known reverse proxy; otherwise
  clients could spoof the IP used by rate limiting.
- Protect `/metrics` with `METRICS_TOKEN` or keep it on a private network.
- The file email outbox is a development adapter. Replace `EmailService` with a
  real transactional provider before production.
- Use `/health` for liveness and `/ready` for readiness probes.

Production checklist:

- Run `npm run build`, set `NODE_ENV=production`, then run `npm run start:prod`.
- Provision Postgres and Redis, apply migrations and configure backups.
- Set a strong `JWT_SECRET`; use `JWT_SECRET_PREVIOUS` only during rotation.
- Set `APP_URL`, `CORS_ORIGINS`, `TRUST_PROXY` and `METRICS_TOKEN` as appropriate.
- Terminate TLS in front of the API; the refresh cookie is `Secure` in production.
- Replace the file outbox with a real email adapter and configure delivery.
- Tune `MAX_ACTIVE_SESSIONS`, `AUTH_DENYLIST_MAX_SIZE`,
  `AUTH_CLEANUP_INTERVAL_MS` and `AUDIT_LOG_RETENTION_DAYS`.

## Current scope

Implemented: identity and sessions, authorization and admin management, audit
trail, Redis-backed rate limiting, email verification/recovery/change, Swagger,
health, readiness and metrics.

Not yet implemented: course catalog, lessons and enrollment domains; MFA;
breached-password checks; a production email provider.

## License

Private and unlicensed (`UNLICENSED`). All rights reserved.
