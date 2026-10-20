import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RateLimitRule } from '../../../rate-limit/rate-limiter.js';
import { RateLimiter } from '../../../rate-limit/rate-limiter.js';
import { PasswordService } from '../../password/password.service.js';
import { AccessTokenService } from '../../token/access-token.service.js';
import { RefreshTokenService } from '../../token/refresh-token.service.js';
import type { RefreshToken } from '../../token/entities/refresh-token.entity.js';
import { DEFAULT_MAX_ACTIVE_SESSIONS } from '../../token/token.constants.js';
import { TOKEN_ERRORS } from '../../token/token.error-codes.js';
import { UserProfilesService } from '../../users/user-profiles.service.js';
import { toUserView, UserView } from '../../users/user.view.js';
import { normalizeIdentity } from '../../users/user.util.js';
import { UsersService } from '../../users/users.service.js';
import { AUTH_ERRORS } from '../auth.error-codes.js';
import type { RequestMeta, SessionTokens } from '../auth.types.js';
import type { AuthenticatedUser } from '../../decorators/current-user.decorator.js';
import { identifierLimitKey, ipLimitKey } from '../rate-limit-keys.js';
import type { SessionView } from './dto/session-list-response.dto.js';

/** Login: 5 attempts per 15 minutes per identifier, 20 per 15 minutes per IP. */
const LOGIN_IDENTIFIER_RULE: RateLimitRule = {
  limit: 5,
  windowSeconds: 15 * 60,
};
const LOGIN_IP_RULE: RateLimitRule = { limit: 20, windowSeconds: 15 * 60 };

/**
 * The session journey: log in (email or username + password), rotate the
 * refresh token, list/revoke individual sessions and log out (one device, all
 * other devices, or everywhere).
 *
 * Login limits are enforced before the password check; a successful login
 * clears the per-identifier counter (typos do not lock the account out for the
 * rest of the window), while the IP counter keeps spraying throttled.
 *
 * Targeted logouts never use the per-user watermark — that would also kill the
 * caller's own access token. They revoke the specific refresh row and denylist
 * its journaled access token for exactly its remaining lifetime instead.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly users: UsersService,
    private readonly profiles: UserProfilesService,
    private readonly passwords: PasswordService,
    private readonly accessTokens: AccessTokenService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly rateLimiter: RateLimiter,
    private readonly config: ConfigService,
  ) {}

  /**
   * Logs a user in and issues a token pair.
   *
   * @param identifier - Email or username.
   * @param password - Plain-text password.
   * @param meta - Request metadata.
   * @returns Access token, refresh token and the user view.
   * @throws UnauthorizedException on unknown account or wrong password.
   * @throws ForbiddenException when a restored account must reset its password
   * or the email is not verified yet.
   */
  async login(
    identifier: string,
    password: string,
    meta: RequestMeta,
  ): Promise<SessionTokens & { user: UserView }> {
    const normalized = normalizeIdentity(identifier);
    await this.rateLimiter.consume(
      identifierLimitKey('login', normalized),
      LOGIN_IDENTIFIER_RULE,
    );
    if (meta.ip) {
      await this.rateLimiter.consume(
        ipLimitKey('login', meta.ip),
        LOGIN_IP_RULE,
      );
    }

    const user = await this.users.findByIdentifier(normalized);
    const passwordValid = await this.passwords.verify(
      password,
      user?.passwordHash ?? null,
    );

    if (!user || !passwordValid) {
      throw new UnauthorizedException({
        code: AUTH_ERRORS.invalidCredentials,
        message: 'Invalid email/username or password.',
      });
    }

    if (user.passwordResetRequired) {
      throw new ForbiddenException({
        code: AUTH_ERRORS.passwordResetRequired,
        message:
          'This account was restored and requires a password reset before logging in.',
      });
    }

    if (user.emailVerifiedAt === null) {
      throw new ForbiddenException({
        code: AUTH_ERRORS.emailNotVerified,
        message: 'Verify your email before logging in.',
      });
    }

    await this.rateLimiter.clear(identifierLimitKey('login', normalized));

    const profile = await this.profiles.findByUserId(user.id);
    const session = await this.issueSession(user.id, meta);
    return { ...session, user: toUserView(user, profile) };
  }

  /**
   * Rotates a refresh token and issues a fresh token pair.
   *
   * @param rawToken - Refresh token from the request cookie.
   * @param meta - Request metadata.
   * @returns New access token, new refresh token and the user view.
   * @throws UnauthorizedException when the refresh token is unusable.
   */
  async refresh(
    rawToken: string,
    meta: RequestMeta,
  ): Promise<SessionTokens & { user: UserView }> {
    const { userId, sessionId, token } = await this.refreshTokens.rotate(
      rawToken,
      meta,
    );

    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedException({
        code: TOKEN_ERRORS.invalidRefreshToken,
        message: 'Invalid or expired refresh token.',
      });
    }

    const profile = await this.profiles.findByUserId(userId);
    const access = await this.accessTokens.signAccessToken(userId);
    await this.refreshTokens.attachAccess(sessionId, {
      jti: access.jti,
      expiresAtMs: access.expiresAtMs,
    });

    return {
      accessToken: access.token,
      refreshToken: token,
      user: toUserView(user, profile),
    };
  }

  /**
   * Lists the authenticated user's active sessions.
   *
   * @param user - Authenticated caller (its `jti` marks the current session).
   * @returns The sessions, newest first.
   */
  async listSessions(
    user: AuthenticatedUser,
  ): Promise<{ sessions: SessionView[] }> {
    const rows = await this.refreshTokens.listActiveForUser(user.id);
    return {
      sessions: rows.map((row) => toSessionView(row, user.jti)),
    };
  }

  /**
   * Revokes one specific session of the authenticated user.
   *
   * Revoking the caller's own session also denylists its access token and the
   * controller clears the refresh cookie; the client is logged out on that
   * device only.
   *
   * @param user - Authenticated caller.
   * @param sessionId - Session id from `GET /auth/sessions`.
   * @returns Message plus whether the revoked session was the caller's own.
   * @throws NotFoundException when the session is not active (or not theirs).
   */
  async revokeSession(
    user: AuthenticatedUser,
    sessionId: string,
  ): Promise<{ message: string; current: boolean }> {
    const row = await this.refreshTokens.revokeSession(user.id, sessionId);
    if (!row) {
      throw new NotFoundException({
        code: TOKEN_ERRORS.sessionNotFound,
        message: 'Session not found.',
      });
    }

    await this.refreshTokens.denyAccessTokenOf(row);
    const current = row.accessJti === user.jti;

    return {
      message: current
        ? 'Session revoked. Log in again on this device.'
        : 'Session revoked.',
      current,
    };
  }

  /**
   * Logs out the current device only: the caller's session row is revoked and
   * its access token denylisted; other devices stay logged in.
   *
   * The caller may authenticate with either a valid access token (the usual
   * guarded path) or the refresh cookie (cookie-only clients and the logout
   * button after the access token expired). Cookie possession authorizes only
   * that one session; it can never revoke another device.
   *
   * @param user - Authenticated caller, when the bearer token was valid.
   * @param rawRefreshToken - Refresh cookie value, when present.
   * @returns Success message.
   * @throws UnauthorizedException when neither credential is usable.
   */
  async logoutCurrent(
    user: AuthenticatedUser | null,
    rawRefreshToken?: string,
  ): Promise<{ message: string }> {
    if (user) {
      const row = await this.refreshTokens.findActiveByAccessJti(
        user.id,
        user.jti,
      );
      if (row) {
        await this.refreshTokens.revokeSession(user.id, row.id);
      }

      // Denylist unconditionally: even when the row is missing (token minted
      // before the journal existed) the token itself must die now.
      await this.denyAccessToken(user);
      return { message: 'Logged out of this device.' };
    }

    if (rawRefreshToken) {
      const row = await this.refreshTokens.revokeByRawToken(rawRefreshToken);
      if (!row) {
        throw new UnauthorizedException({
          code: TOKEN_ERRORS.invalidRefreshToken,
          message: 'Invalid or expired refresh token.',
        });
      }
      return { message: 'Logged out of this device.' };
    }

    throw new UnauthorizedException({
      code: TOKEN_ERRORS.missingToken,
      message: 'Authentication required.',
    });
  }

  /**
   * Logs out every device except the current one.
   *
   * @param user - Authenticated caller.
   * @returns Success message.
   */
  async logoutOthers(user: AuthenticatedUser): Promise<{ message: string }> {
    await this.refreshTokens.revokeOtherSessions(user.id, user.jti);
    return { message: 'Logged out of other devices.' };
  }

  /**
   * Logs the user out on every device: all refresh tokens are revoked and the
   * access-token watermark kills outstanding access tokens immediately.
   *
   * @param userId - Authenticated user.
   * @returns Success message.
   */
  async logout(userId: string): Promise<{ message: string }> {
    await this.refreshTokens.revokeAllForUser(userId);
    return { message: 'Logged out on all devices.' };
  }

  /** Issues a refresh token (ledger row) plus an access token. */
  private async issueSession(
    userId: string,
    meta: RequestMeta,
  ): Promise<SessionTokens> {
    const access = await this.accessTokens.signAccessToken(userId);
    const refreshToken = await this.refreshTokens.issue(userId, meta, {
      jti: access.jti,
      expiresAtMs: access.expiresAtMs,
    });
    await this.refreshTokens.enforceLimit(userId, this.maxActiveSessions());
    return { accessToken: access.token, refreshToken };
  }

  /** Reads and validates the active-session cap from configuration. */
  private maxActiveSessions(): number {
    const raw = this.config.get<string>('MAX_ACTIVE_SESSIONS');
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    return Number.isInteger(parsed) && parsed > 0
      ? parsed
      : DEFAULT_MAX_ACTIVE_SESSIONS;
  }

  /** Denylists the caller's own access token for its remaining lifetime. */
  private async denyAccessToken(user: AuthenticatedUser): Promise<void> {
    await this.refreshTokens.denyAccessJti(user.jti, user.accessExpiresAtMs);
  }
}

/**
 * Maps a ledger row to its API representation.
 *
 * @param row - Active refresh-token row.
 * @param currentJti - Access token id of the caller.
 * @returns The session view.
 */
function toSessionView(row: RefreshToken, currentJti: string): SessionView {
  return {
    id: row.id,
    ip: row.ip,
    userAgent: row.userAgent,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    current: row.accessJti === currentJti,
  };
}
