import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { TOKEN_ERRORS } from '../token/token.error-codes.js';

/**
 * The authenticated caller, attached to the request by `JwtAuthGuard`.
 *
 * `isSuperuser` is loaded from the account on every request so guards can
 * bypass attribute checks without another lookup. `jti`/`accessExpiresAtMs`
 * identify the exact access token, which targeted session endpoints need to
 * denylist it.
 */
export interface AuthenticatedUser {
  id: string;
  isSuperuser: boolean;
  /** `jti` of the access token that authenticated this request. */
  jti: string;
  /** Millisecond expiry of that access token. */
  accessExpiresAtMs: number;
}

/**
 * Injects the authenticated user into a controller handler.
 *
 * Only meaningful on routes protected by `JwtAuthGuard`.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();

    if (!request.user) {
      throw new UnauthorizedException({
        code: TOKEN_ERRORS.missingToken,
        message: 'Authentication required.',
      });
    }

    return request.user;
  },
);
