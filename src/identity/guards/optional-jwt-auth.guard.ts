import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { RevocationService } from '../token/revocation.service.js';
import { AccessTokenService } from '../token/access-token.service.js';
import { UsersService } from '../users/users.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

/**
 * Authenticates a bearer token when one is present, but never rejects the
 * request for a missing or invalid one.
 *
 * Used only by `POST /auth/logout/current`, which also accepts the httpOnly
 * refresh cookie as its credential. The handler must therefore treat
 * `request.user` as optional and validate the alternative itself.
 */
@Injectable()
export class OptionalJwtAuthGuard extends JwtAuthGuard {
  constructor(
    tokens: AccessTokenService,
    revocation: RevocationService,
    users: UsersService,
  ) {
    super(tokens, revocation, users);
  }

  /**
   * @param context - Execution context of the incoming request.
   * @returns `true` always; a valid token additionally attaches `request.user`.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      return await super.canActivate(context);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        return true;
      }
      throw error;
    }
  }
}
