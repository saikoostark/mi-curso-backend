import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { COMMON_ERROR_CODES } from '../common/http/error-codes.js';

/**
 * Protects `/metrics` when `METRICS_TOKEN` is configured.
 *
 * The expected and supplied tokens are hashed before a constant-time compare,
 * so neither length nor prefix timing leaks. With no token configured the
 * endpoint is intentionally open (scrapers on a private network); production
 * deployments that expose it publicly should set the variable.
 */
@Injectable()
export class MetricsTokenGuard implements CanActivate {
  private readonly expectedHash: Buffer | null;

  constructor(config: ConfigService) {
    const token = config.get<string>('METRICS_TOKEN');
    this.expectedHash =
      token && token.trim() !== ''
        ? createHash('sha256').update(token).digest()
        : null;
  }

  /**
   * @param context - Execution context of the metrics request.
   * @returns `true` when metrics are unprotected or the bearer token matches.
   * @throws UnauthorizedException when a token is required and missing/wrong.
   */
  canActivate(context: ExecutionContext): boolean {
    if (!this.expectedHash) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    const supplied = header?.startsWith('Bearer ')
      ? header.slice('Bearer '.length)
      : '';

    if (supplied.length > 0) {
      const suppliedHash = createHash('sha256').update(supplied).digest();
      if (timingSafeEqual(this.expectedHash, suppliedHash)) {
        return true;
      }
    }

    throw new UnauthorizedException({
      code: COMMON_ERROR_CODES.unauthorized,
      message: 'A valid metrics token is required.',
    });
  }
}
