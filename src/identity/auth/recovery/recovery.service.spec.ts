import { HttpException } from '@nestjs/common';
import type { RateLimiter } from '../../../rate-limit/rate-limiter.js';
import type { AuthTokenService } from '../../token/auth-token.service.js';
import { TOKEN_ERRORS } from '../../token/token.error-codes.js';
import type { User } from '../../users/user.entity.js';
import type { UsersService } from '../../users/users.service.js';
import type { RequestMeta } from '../auth.types.js';
import type { PasswordUpdateService } from '../account/password-update.service.js';
import type { PasswordResetService } from '../password-reset.service.js';
import { identifierLimitKey, ipLimitKey } from '../rate-limit-keys.js';
import { RecoveryService } from './recovery.service.js';

/** User entity factory for test data. */
function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'jane@example.com',
    username: 'janedoe',
    passwordHash: 'stored-hash',
    emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
    isSuperuser: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as unknown as User;
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

describe('RecoveryService', () => {
  let users: ReturnType<typeof createUsersMock>;
  let authTokens: ReturnType<typeof createAuthTokensMock>;
  let passwordReset: ReturnType<typeof createPasswordResetMock>;
  let rateLimiter: ReturnType<typeof createRateLimiterMock>;
  let passwordUpdate: ReturnType<typeof createPasswordUpdateMock>;
  let service: RecoveryService;

  const meta: RequestMeta = { ip: '1.2.3.4', userAgent: 'vitest' };

  beforeEach(() => {
    users = createUsersMock();
    authTokens = createAuthTokensMock();
    passwordReset = createPasswordResetMock();
    rateLimiter = createRateLimiterMock();
    passwordUpdate = createPasswordUpdateMock();

    service = new RecoveryService(
      users as unknown as UsersService,
      authTokens as unknown as AuthTokenService,
      passwordReset as unknown as PasswordResetService,
      rateLimiter as unknown as RateLimiter,
      passwordUpdate as unknown as PasswordUpdateService,
    );
  });

  describe('forgotPassword', () => {
    it('stays generic and sends nothing for unknown accounts', async () => {
      users.findByIdentifier.mockResolvedValue(null);

      const result = await service.forgotPassword('ghost@example.com', meta);

      expect(result.message).toContain('If an account exists');
      expect(passwordReset.sendResetLink).not.toHaveBeenCalled();
    });

    it('applies the identifier and IP limits', async () => {
      users.findByIdentifier.mockResolvedValue(null);

      await service.forgotPassword('Jane@Example.com', meta);

      expect(rateLimiter.consume).toHaveBeenCalledWith(
        identifierLimitKey('forgot', 'jane@example.com'),
        { limit: 3, windowSeconds: 3600 },
      );
      expect(rateLimiter.consume).toHaveBeenCalledWith(
        ipLimitKey('forgot', '1.2.3.4'),
        { limit: 10, windowSeconds: 3600 },
      );
    });

    it('sends a reset link for known accounts', async () => {
      users.findByIdentifier.mockResolvedValue(makeUser());

      await service.forgotPassword('jane@example.com', meta);

      expect(passwordReset.sendResetLink).toHaveBeenCalledWith(
        'user-1',
        'jane@example.com',
      );
    });
  });

  describe('resetPassword', () => {
    it('delegates validation and revocation to the shared password tail', async () => {
      const user = makeUser();
      authTokens.consume.mockResolvedValue('user-1');
      users.findById.mockResolvedValue(user);

      const result = await service.resetPassword(
        'reset-token',
        'NewStr0ngPassw',
        'NewStr0ngPassw',
      );

      expect(authTokens.consume).toHaveBeenCalledWith(
        'reset-token',
        'password_reset',
      );
      expect(passwordUpdate.updatePassword).toHaveBeenCalledWith(
        user,
        'NewStr0ngPassw',
        'NewStr0ngPassw',
      );
      expect(result.message).toContain('reset');
    });

    it('rejects when the token owner no longer exists', async () => {
      authTokens.consume.mockResolvedValue('user-1');
      users.findById.mockResolvedValue(null);

      const body = await httpErrorBody(
        () =>
          service.resetPassword(
            'reset-token',
            'NewStr0ngPassw',
            'NewStr0ngPassw',
          ),
        400,
      );

      expect(body.code).toBe(TOKEN_ERRORS.invalidToken);
      expect(passwordUpdate.updatePassword).not.toHaveBeenCalled();
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

/** AuthTokenService mock issuing a recognizable link token. */
function createAuthTokensMock() {
  return {
    issue: vi.fn().mockResolvedValue('link-token'),
    consume: vi.fn(),
  };
}

/** PasswordResetService mock. */
function createPasswordResetMock() {
  return {
    sendResetLink: vi.fn().mockResolvedValue(undefined),
  };
}

/** RateLimiter mock (all limits pass). */
function createRateLimiterMock() {
  return {
    consume: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  };
}

/** PasswordUpdateService mock. */
function createPasswordUpdateMock() {
  return {
    updatePassword: vi.fn().mockResolvedValue(undefined),
  };
}
