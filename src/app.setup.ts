import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { COMMON_ERROR_CODES } from './common/http/error-codes.js';
import { flattenValidationErrors } from './common/http/validation-error.js';

/**
 * Applies the HTTP-level configuration shared by `main.ts` and the e2e specs.
 *
 * Keeping this in one place guarantees tests exercise the same cookie parsing,
 * proxy handling and DTO validation as the real server. Validation failures are
 * reshaped into the common error envelope through `ApiExceptionFilter`; the pipe
 * itself only supplies the `code`/`details` payload.
 *
 * @param app - Nest application (or testing application) to configure.
 */
export function configureApp(app: INestApplication): void {
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy !== undefined && trustProxy.trim() !== '') {
    // Behind a reverse proxy, `request.ip` (and therefore every rate limiter)
    // must use the forwarding headers instead of the proxy's address. Opt-in:
    // trusting those headers without a proxy lets clients spoof their IP.
    const instance = app.getHttpAdapter().getInstance() as {
      set(field: string, value: unknown): void;
    };
    instance.set('trust proxy', parseTrustProxy(trustProxy));
  }

  // Cross-origin browser clients must be explicitly allowlisted; wildcard
  // origins are rejected because credentials (the refresh cookie) are allowed.
  const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGINS);
  if (corsOrigins.length > 0) {
    app.enableCors({
      credentials: true,
      origin: (
        origin: string | undefined,
        callback: (error: Error | null, allow?: boolean) => void,
      ) => {
        if (!origin || corsOrigins.includes(origin)) {
          callback(null, true);
        } else {
          // Refuse the CORS headers without turning the response into a 500.
          callback(null, false);
        }
      },
    });
  }

  // Populates `request.cookies` (used for the refresh token cookie).
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (errors) =>
        new BadRequestException({
          code: COMMON_ERROR_CODES.validationFailed,
          message: 'Validation failed.',
          details: flattenValidationErrors(errors),
        }),
    }),
  );
}

/**
 * Parses the `TRUST_PROXY` value into the setting Express expects.
 *
 * Accepted forms mirror Express: `true`/`false`, a hop count (`1`, `2`, ...),
 * or an address/subnet list (`loopback`, `10.0.0.0/8,172.16.0.0/12`). Invalid
 * hop counts are passed through untouched so Express rejects them at boot
 * instead of silently trusting the wrong hops.
 *
 * @param raw - Raw environment value.
 * @returns The Express `trust proxy` setting.
 */
export function parseTrustProxy(raw: string): boolean | number | string {
  const value = raw.trim();

  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  return value;
}

/**
 * Parses the `CORS_ORIGINS` comma-separated allowlist.
 *
 * Empty entries are ignored and a trailing slash is stripped so
 * `https://app.example.com/` and `https://app.example.com` match the same
 * Origin header. `*` is rejected: credentials are enabled, and the browser
 * forbids `Access-Control-Allow-Origin: *` with credentials anyway — failing at
 * boot is clearer than a configuration that silently cannot work.
 *
 * @param raw - Raw environment value, when set.
 * @returns Allowed origins in configuration order.
 * @throws Error when the wildcard origin is configured.
 */
export function parseCorsOrigins(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  const origins = raw
    .split(',')
    .map((value) => value.trim().replace(/\/$/, ''))
    .filter((value) => value.length > 0);

  if (origins.includes('*')) {
    throw new Error('CORS_ORIGINS must list explicit origins, not "*".');
  }

  return origins;
}
