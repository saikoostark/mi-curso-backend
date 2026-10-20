import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthenticatedUser } from '../decorators/current-user.decorator.js';
import { RevocationService } from '../token/revocation.service.js';
import {
  AccessTokenPayload,
  AccessTokenService,
} from '../token/access-token.service.js';
import { UsersService } from '../users/users.service.js';
import type { TokenErrorCode } from '../token/token.error-codes.js';
import { TOKEN_ERRORS } from '../token/token.error-codes.js';

/**
 * Authenticates requests via the `Authorization: Bearer <jwt>` header.
 *
 * Beyond signature/expiry verification this enforces the cache revocation
 * state — JTI denylist first, then the per-user "revoked before" watermark —
 * so logout-all and password changes invalidate access tokens immediately. The
 * account is then loaded so deleted users lose access at once and guards see
 * the `isSuperuser` flag; on success the caller is attached to the request as
 * `request.user`.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: AccessTokenService,
    private readonly revocation: RevocationService,
    private readonly users: UsersService,
  ) {}

  /**
   * @param context - Execution context of the incoming request.
   * @returns `true` when the request may proceed.
   * @throws UnauthorizedException for missing, invalid or revoked tokens.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();

    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw unauthorized(TOKEN_ERRORS.missingToken, 'Authentication required.');
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.tokens.verifyAccessToken(token);
    } catch {
      throw unauthorized(
        TOKEN_ERRORS.invalidToken,
        'Invalid or expired token.',
      );
    }

    if (await this.revocation.isJtiDenied(payload.jti)) {
      throw unauthorized(
        TOKEN_ERRORS.tokenRevoked,
        'This token has been revoked.',
      );
    }

    if (await this.revocation.isRevoked(payload.sub, payload.iatMs)) {
      throw unauthorized(
        TOKEN_ERRORS.tokenRevoked,
        'This token has been revoked.',
      );
    }

    // The account must still exist; its flag drives the attribute bypass.
    const user = await this.users.findById(payload.sub);
    if (!user) {
      throw unauthorized(
        TOKEN_ERRORS.invalidToken,
        'Invalid or expired token.',
      );
    }

    request.user = {
      id: user.id,
      isSuperuser: user.isSuperuser,
      jti: payload.jti,
      accessExpiresAtMs: payload.exp * 1000,
    };
    return true;
  }
}

/**
 * Extracts the token from an `Authorization` header.
 *
 * @param header - Raw header value, when present.
 * @returns The token, or `undefined` when the header is missing/malformed.
 */
function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) {
    return undefined;
  }

  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) {
    return undefined;
  }

  return value;
}

/** Builds a uniform 401 with a machine-readable `code`. */
function unauthorized(
  code: TokenErrorCode,
  message: string,
): UnauthorizedException {
  return new UnauthorizedException({ code, message });
}
