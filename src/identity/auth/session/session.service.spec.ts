import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { RateLimiter } from '../../../rate-limit/rate-limiter.js';
import type { AuthenticatedUser } from '../../decorators/current-user.decorator.js';
import { PasswordService } from '../../password/password.service.js';
import type { AccessTokenService } from '../../token/access-token.service.js';
import type { RefreshToken } from '../../token/entities/refresh-token.entity.js';
import type { RefreshTokenService } from '../../token/refresh-token.service.js';
import { TOKEN_ERRORS } from '../../token/token.error-codes.js';
import type { UserProfile } from '../../users/user-profile.entity.js';
import type { User } from '../../users/user.entity.js';
import type { UserProfilesService } from '../../users/user-profiles.service.js';
import type { UsersService } from '../../users/users.service.js';
import { AUTH_ERRORS } from '../auth.error-codes.js';
import type { RequestMeta } from '../auth.types.js';
import { identifierLimitKey, ipLimitKey } from '../rate-limit-keys.js';
import { SessionService } from './session.service.js';

/** User entity factory for test data. */
function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'jane@example.com',
    username: 'janedoe',
    passwordHash: 'stored-hash',
    emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
    isSuperuser: false,
    passwordResetRequired: false,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as unknown as User;
}

/** Profile entity factory for test data. */
function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    userId: 'user-1',
    firstName: 'Jane',
    lastName: 'Doe',
    phone: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as unknown as UserProfile;
}

/** Refresh-token row factory for session views. */
function makeRow(overrides: Partial<RefreshToken> = {}): RefreshToken {
  return {
    id: 'row-1',
    userId: 'user-1',
    tokenHash: 'hash',
    expiresAt: new Date('2026-02-01T00:00:00Z'),
    revokedAt: null,
    replacedByHash: null,
    accessJti: 'access-jti',
    accessExpiresAt: new Date('2026-01-01T00:15:00Z'),
    userAgent: 'vitest',
    ip: '1.2.3.4',
    lastUsedAt: new Date('2026-01-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as unknown as RefreshToken;
}

/** Authenticated caller factory. */
function makeActor(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'user-1',
    isSuperuser: false,
    jti: 'current-jti',
    accessExpiresAtMs: Date.now() + 60_000,
    ...overrides,
  };
}

/** Runs the call and returns the HTTP error body, failing when it resolves. */
async function httpErrorBody(
  run: () => Promise<unknown>,
  status: number,
): Promise<Record<string, unknown>> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    const exception = error as HttpException;
    expect(exception.getStatus()).toBe(status);
    return exception.getResponse() as Record<string, unknown>;
  }

  throw new Error(`Expected a ${status} HttpException`);
}

describe('SessionService', () => {
  let users: ReturnType<typeof createUsersMock>;
  let profiles: ReturnType<typeof createProfilesMock>;
  let passwords: PasswordService;
  let accessTokens: ReturnType<typeof createAccessTokensMock>;
  let refreshTokens: ReturnType<typeof createRefreshTokensMock>;
  let rateLimiter: ReturnType<typeof createRateLimiterMock>;
  let config: ReturnType<typeof createConfigMock>;
  let service: SessionService;

  const meta: RequestMeta = { ip: '1.2.3.4', userAgent: 'vitest' };

  beforeEach(() => {
    users = createUsersMock();
    profiles = createProfilesMock();
    passwords = new PasswordService();
    accessTokens = createAccessTokensMock();
    refreshTokens = createRefreshTokensMock();
    rateLimiter = createRateLimiterMock();
    config = createConfigMock();

    service = new SessionService(
      users as unknown as UsersService,
      profiles as unknown as UserProfilesService,
      passwords,
      accessTokens as unknown as AccessTokenService,
      refreshTokens as unknown as RefreshTokenService,
      rateLimiter as unknown as RateLimiter,
      config as unknown as ConfigService,
    );
  });

  describe('login', () => {
    it('rejects unknown accounts with a generic error', async () => {
      users.findByIdentifier.mockResolvedValue(null);
      const verify = vi.spyOn(passwords, 'verify').mockResolvedValue(false);

      const body = await httpErrorBody(
        () => service.login('ghost@example.com', 'whatever', meta),
        401,
      );

      expect(body.code).toBe(AUTH_ERRORS.invalidCredentials);
      expect(verify).toHaveBeenCalledWith('whatever', null);
      expect(rateLimiter.clear).not.toHaveBeenCalled();
    });

    it('rejects wrong passwords', async () => {
      users.findByIdentifier.mockResolvedValue(makeUser());
      vi.spyOn(passwords, 'verify').mockResolvedValue(false);

      const body = await httpErrorBody(
        () => service.login('jane@example.com', 'wrong', meta),
        401,
      );

      expect(body.code).toBe(AUTH_ERRORS.invalidCredentials);
    });

    it('blocks unverified accounts without clearing the counter', async () => {
      users.findByIdentifier.mockResolvedValue(
        makeUser({ emailVerifiedAt: null }),
      );
      vi.spyOn(passwords, 'verify').mockResolvedValue(true);

      const body = await httpErrorBody(
        () => service.login('jane@example.com', 'correct', meta),
        403,
      );

      expect(body.code).toBe(AUTH_ERRORS.emailNotVerified);
      expect(rateLimiter.clear).not.toHaveBeenCalled();
    });

    it('blocks a restored account until it resets its password', async () => {
      users.findByIdentifier.mockResolvedValue(
        makeUser({ passwordResetRequired: true }),
      );
      vi.spyOn(passwords, 'verify').mockResolvedValue(true);

      const body = await httpErrorBody(
        () => service.login('jane@example.com', 'correct', meta),
        403,
      );

      expect(body.code).toBe(AUTH_ERRORS.passwordResetRequired);
      expect(refreshTokens.issue).not.toHaveBeenCalled();
      expect(rateLimiter.clear).not.toHaveBeenCalled();
    });

    it('issues a token pair and clears the failure counter on success', async () => {
      users.findByIdentifier.mockResolvedValue(makeUser());
      profiles.findByUserId.mockResolvedValue(makeProfile());
      vi.spyOn(passwords, 'verify').mockResolvedValue(true);

      const result = await service.login('Jane@Example.com', 'correct', meta);

      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(result.user.email).toBe('jane@example.com');
      expect(result.user.firstName).toBe('Jane');
      expect(refreshTokens.issue).toHaveBeenCalledWith('user-1', meta, {
        jti: 'access-jti',
        expiresAtMs: 1_800_000_000_000,
      });
      expect(refreshTokens.enforceLimit).toHaveBeenCalledWith('user-1', 10);
      expect(profiles.findByUserId).toHaveBeenCalledWith('user-1');
      expect(rateLimiter.consume).toHaveBeenCalledWith(
        identifierLimitKey('login', 'jane@example.com'),
        { limit: 5, windowSeconds: 900 },
      );
      expect(rateLimiter.consume).toHaveBeenCalledWith(
        ipLimitKey('login', '1.2.3.4'),
        { limit: 20, windowSeconds: 900 },
      );
      expect(rateLimiter.clear).toHaveBeenCalledWith(
        identifierLimitKey('login', 'jane@example.com'),
      );
    });

    it('uses the configured active-session cap', async () => {
      config.get.mockReturnValue('3');
      users.findByIdentifier.mockResolvedValue(makeUser());
      vi.spyOn(passwords, 'verify').mockResolvedValue(true);

      await service.login('jane@example.com', 'correct', meta);

      expect(refreshTokens.enforceLimit).toHaveBeenCalledWith('user-1', 3);
    });

    it('skips the IP rule when the IP is unknown', async () => {
      users.findByIdentifier.mockResolvedValue(makeUser());
      vi.spyOn(passwords, 'verify').mockResolvedValue(true);

      await service.login('jane@example.com', 'correct', {
        ip: null,
        userAgent: null,
      });

      expect(rateLimiter.consume).toHaveBeenCalledTimes(1);
      expect(rateLimiter.consume).toHaveBeenCalledWith(
        identifierLimitKey('login', 'jane@example.com'),
        { limit: 5, windowSeconds: 900 },
      );
    });
  });

  describe('refresh', () => {
    it('rotates and returns a fresh pair, journaling the new access token', async () => {
      refreshTokens.rotate.mockResolvedValue({
        userId: 'user-1',
        sessionId: 'session-2',
        token: 'new-refresh',
      });
      users.findById.mockResolvedValue(makeUser());
      profiles.findByUserId.mockResolvedValue(makeProfile());

      const result = await service.refresh('old-refresh', meta);

      expect(result.refreshToken).toBe('new-refresh');
      expect(result.accessToken).toBe('access-token');
      expect(result.user.id).toBe('user-1');
      expect(result.user.lastName).toBe('Doe');
      expect(refreshTokens.attachAccess).toHaveBeenCalledWith('session-2', {
        jti: 'access-jti',
        expiresAtMs: 1_800_000_000_000,
      });
    });

    it('rejects when the user vanished mid-flight', async () => {
      refreshTokens.rotate.mockResolvedValue({
        userId: 'user-1',
        sessionId: 'session-2',
        token: 'new-refresh',
      });
      users.findById.mockResolvedValue(null);

      await expect(service.refresh('old-refresh', meta)).rejects.toBeInstanceOf(
        HttpException,
      );
      expect(refreshTokens.attachAccess).not.toHaveBeenCalled();
    });
  });

  describe('sessions', () => {
    it('lists active sessions and marks the caller', async () => {
      refreshTokens.listActiveForUser.mockResolvedValue([
        makeRow({ id: 'current', accessJti: 'current-jti' }),
        makeRow({ id: 'other', accessJti: 'other-jti' }),
        makeRow({ id: 'legacy', accessJti: null }),
      ]);

      const result = await service.listSessions(makeActor());

      expect(result.sessions.map((session) => session.current)).toEqual([
        true,
        false,
        false,
      ]);
      expect(result.sessions[0]).toMatchObject({
        id: 'current',
        ip: '1.2.3.4',
        userAgent: 'vitest',
      });
      expect(result.sessions[0].lastUsedAt).toEqual(
        new Date('2026-01-01T00:00:00Z'),
      );
    });

    it('revokes a specific session and reports when it was the caller’s own', async () => {
      refreshTokens.revokeSession.mockResolvedValue(
        makeRow({ id: 'current', accessJti: 'current-jti' }),
      );

      const result = await service.revokeSession(makeActor(), 'current');

      expect(refreshTokens.revokeSession).toHaveBeenCalledWith(
        'user-1',
        'current',
      );
      expect(refreshTokens.denyAccessTokenOf).toHaveBeenCalled();
      expect(result.current).toBe(true);
    });

    it('revokes another device without logging the caller out', async () => {
      refreshTokens.revokeSession.mockResolvedValue(
        makeRow({ id: 'other', accessJti: 'other-jti' }),
      );

      const result = await service.revokeSession(makeActor(), 'other');

      expect(result.current).toBe(false);
      expect(result.message).not.toContain('Log in again');
    });

    it('maps unknown sessions to 404', async () => {
      refreshTokens.revokeSession.mockResolvedValue(null);

      const body = await httpErrorBody(
        () => service.revokeSession(makeActor(), 'missing'),
        404,
      );

      expect(body.code).toBe(TOKEN_ERRORS.sessionNotFound);
      expect(refreshTokens.denyAccessTokenOf).not.toHaveBeenCalled();
    });

    it('logs out the current device and denylists its access token', async () => {
      refreshTokens.findActiveByAccessJti.mockResolvedValue(
        makeRow({ id: 'current' }),
      );

      const result = await service.logoutCurrent(makeActor());

      expect(refreshTokens.findActiveByAccessJti).toHaveBeenCalledWith(
        'user-1',
        'current-jti',
      );
      expect(refreshTokens.revokeSession).toHaveBeenCalledWith(
        'user-1',
        'current',
      );
      expect(refreshTokens.denyAccessJti).toHaveBeenCalledWith(
        'current-jti',
        expect.any(Number),
      );
      expect(result.message).toContain('device');
    });

    it('still denylists the token when the session row is missing', async () => {
      refreshTokens.findActiveByAccessJti.mockResolvedValue(null);

      await service.logoutCurrent(makeActor());

      expect(refreshTokens.revokeSession).not.toHaveBeenCalled();
      expect(refreshTokens.denyAccessJti).toHaveBeenCalledWith(
        'current-jti',
        expect.any(Number),
      );
    });

    it('logs out with only the refresh cookie', async () => {
      refreshTokens.revokeByRawToken.mockResolvedValue(
        makeRow({ id: 'cookie-session' }),
      );

      const result = await service.logoutCurrent(null, 'raw-refresh');

      expect(refreshTokens.revokeByRawToken).toHaveBeenCalledWith(
        'raw-refresh',
      );
      expect(refreshTokens.findActiveByAccessJti).not.toHaveBeenCalled();
      expect(result.message).toContain('device');
    });

    it('rejects an unusable refresh cookie', async () => {
      refreshTokens.revokeByRawToken.mockResolvedValue(null);

      const body = await httpErrorBody(
        () => service.logoutCurrent(null, 'stale-refresh'),
        401,
      );

      expect(body.code).toBe(TOKEN_ERRORS.invalidRefreshToken);
    });

    it('requires an access token or the refresh cookie', async () => {
      const body = await httpErrorBody(() => service.logoutCurrent(null), 401);

      expect(body.code).toBe(TOKEN_ERRORS.missingToken);
    });

    it('logs out other devices through the targeted revoke', async () => {
      const result = await service.logoutOthers(makeActor());

      expect(refreshTokens.revokeOtherSessions).toHaveBeenCalledWith(
        'user-1',
        'current-jti',
      );
      expect(result.message).toContain('other devices');
    });
  });

  describe('logout', () => {
    it('revokes every session of the user', async () => {
      const result = await service.logout('user-1');

      expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith('user-1');
      expect(result.message).toContain('all devices');
    });
  });
});

/** UsersService mock with per-method vi.fn()s. */
function createUsersMock() {
  return {
    findByIdentifier: vi.fn(),
    findById: vi.fn(),
  };
}

/** UserProfilesService mock with per-method vi.fn()s. */
function createProfilesMock() {
  return {
    findByUserId: vi.fn(),
  };
}

/** AccessTokenService mock issuing a recognizable access token. */
function createAccessTokensMock() {
  return {
    signAccessToken: vi.fn().mockResolvedValue({
      token: 'access-token',
      jti: 'access-jti',
      expiresAtMs: 1_800_000_000_000,
    }),
  };
}

/** RefreshTokenService mock issuing a recognizable refresh token. */
function createRefreshTokensMock() {
  return {
    issue: vi.fn().mockResolvedValue('refresh-token'),
    rotate: vi.fn(),
    attachAccess: vi.fn().mockResolvedValue(undefined),
    listActiveForUser: vi.fn().mockResolvedValue([]),
    findActiveByAccessJti: vi.fn(),
    revokeSession: vi.fn(),
    revokeByRawToken: vi.fn(),
    enforceLimit: vi.fn().mockResolvedValue(0),
    revokeOtherSessions: vi.fn().mockResolvedValue(0),
    denyAccessTokenOf: vi.fn().mockResolvedValue(undefined),
    denyAccessJti: vi.fn().mockResolvedValue(undefined),
    revokeAllForUser: vi.fn().mockResolvedValue(undefined),
  };
}

/** RateLimiter mock (all limits pass). */
function createRateLimiterMock() {
  return {
    consume: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  };
}

/** ConfigService mock with an unset env by default. */
function createConfigMock() {
  return {
    get: vi.fn().mockReturnValue(undefined),
  };
}
