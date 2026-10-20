import { HttpException } from '@nestjs/common';
import type { RateLimiter } from '../../../rate-limit/rate-limiter.js';
import { PASSWORD_ERRORS } from '../../password/password.error-codes.js';
import { PasswordService } from '../../password/password.service.js';
import type { AuthTokenService } from '../../token/auth-token.service.js';
import type { UserProvisioningService } from '../../users/user-provisioning.service.js';
import type { User } from '../../users/user.entity.js';
import { USER_ERRORS } from '../../users/users.error-codes.js';
import type { UsersService } from '../../users/users.service.js';
import type { RequestMeta } from '../auth.types.js';
import type { EmailVerificationService } from '../email-verification.service.js';
import { identifierLimitKey, ipLimitKey } from '../rate-limit-keys.js';
import type { RegisterDto } from './dto/register.dto.js';
import { RegistrationService } from './registration.service.js';

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

describe('RegistrationService', () => {
  let users: ReturnType<typeof createUsersMock>;
  let provisioning: ReturnType<typeof createProvisioningMock>;
  let passwords: PasswordService;
  let authTokens: ReturnType<typeof createAuthTokensMock>;
  let verification: ReturnType<typeof createVerificationMock>;
  let rateLimiter: ReturnType<typeof createRateLimiterMock>;
  let service: RegistrationService;

  const meta: RequestMeta = { ip: '1.2.3.4', userAgent: 'vitest' };
  const registerDto: RegisterDto = {
    email: 'jane@example.com',
    username: 'janedoe',
    password: 'Str0ngPassphrase',
    passwordConfirm: 'Str0ngPassphrase',
  };

  beforeEach(() => {
    users = createUsersMock();
    provisioning = createProvisioningMock();
    passwords = new PasswordService();
    vi.spyOn(passwords, 'hash').mockResolvedValue('hashed-password');
    authTokens = createAuthTokensMock();
    verification = createVerificationMock();
    rateLimiter = createRateLimiterMock();

    service = new RegistrationService(
      users as unknown as UsersService,
      provisioning as unknown as UserProvisioningService,
      passwords,
      authTokens as unknown as AuthTokenService,
      verification as unknown as EmailVerificationService,
      rateLimiter as unknown as RateLimiter,
    );
  });

  describe('register', () => {
    it('creates an unverified user and sends the verification email', async () => {
      const user = makeUser({ emailVerifiedAt: null });
      users.existsByEmail.mockResolvedValue(false);
      users.existsByUsername.mockResolvedValue(false);
      provisioning.createUnverified.mockResolvedValue({
        user,
        profile: { userId: user.id },
      });

      const result = await service.register(registerDto, meta);

      expect(result.message).toContain('Registration successful');
      expect(rateLimiter.consume).toHaveBeenCalledWith(
        ipLimitKey('register', '1.2.3.4'),
        { limit: 5, windowSeconds: 3600 },
      );
      expect(provisioning.createUnverified).toHaveBeenCalledWith({
        email: 'jane@example.com',
        username: 'janedoe',
        passwordHash: 'hashed-password',
        profile: {
          firstName: null,
          lastName: null,
          phone: null,
        },
      });
      expect(verification.sendVerificationTo).toHaveBeenCalledWith(
        'user-1',
        'jane@example.com',
      );
    });

    it('normalizes email and username and forwards profile fields', async () => {
      users.existsByEmail.mockResolvedValue(false);
      users.existsByUsername.mockResolvedValue(false);
      provisioning.createUnverified.mockResolvedValue({
        user: makeUser(),
        profile: { userId: 'user-1' },
      });

      await service.register(
        {
          email: '  JANE@Example.com ',
          username: 'JaneDoe',
          password: 'Str0ngPassphrase',
          passwordConfirm: 'Str0ngPassphrase',
          firstName: 'Jane',
          lastName: 'Doe',
        },
        meta,
      );

      expect(provisioning.createUnverified).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'jane@example.com',
          username: 'janedoe',
          profile: expect.objectContaining({
            firstName: 'Jane',
            lastName: 'Doe',
          }),
        }),
      );
    });

    it('skips the IP rule when the IP is unknown', async () => {
      users.existsByEmail.mockResolvedValue(false);
      users.existsByUsername.mockResolvedValue(false);
      provisioning.createUnverified.mockResolvedValue({
        user: makeUser(),
        profile: { userId: 'user-1' },
      });

      await service.register(registerDto, { ip: null, userAgent: null });

      expect(rateLimiter.consume).not.toHaveBeenCalled();
    });

    it('rejects mismatched password confirmations', async () => {
      const body = await httpErrorBody(
        () =>
          service.register(
            {
              email: 'jane@example.com',
              username: 'janedoe',
              password: 'Str0ngPassphrase',
              passwordConfirm: 'SomethingElse123',
            },
            meta,
          ),
        400,
      );

      expect(body.code).toBe(PASSWORD_ERRORS.passwordMismatch);
      expect(provisioning.createUnverified).not.toHaveBeenCalled();
    });

    it('rejects passwords that violate the policy', async () => {
      const body = await httpErrorBody(
        () =>
          service.register(
            {
              email: 'jane@example.com',
              username: 'janedoe',
              password: 'Janedoe1Passw',
              passwordConfirm: 'Janedoe1Passw',
            },
            meta,
          ),
        400,
      );

      expect(body.code).toBe(PASSWORD_ERRORS.passwordPolicy);
      expect(provisioning.createUnverified).not.toHaveBeenCalled();
    });

    it('rejects already-registered emails', async () => {
      users.existsByEmail.mockResolvedValue(true);

      const body = await httpErrorBody(
        () => service.register(registerDto, meta),
        409,
      );

      expect(body.code).toBe(USER_ERRORS.emailTaken);
    });

    it('rejects taken usernames', async () => {
      users.existsByEmail.mockResolvedValue(false);
      users.existsByUsername.mockResolvedValue(true);

      const body = await httpErrorBody(
        () => service.register(registerDto, meta),
        409,
      );

      expect(body.code).toBe(USER_ERRORS.usernameTaken);
    });
  });

  describe('verifyEmail', () => {
    it('marks the account verified', async () => {
      authTokens.consume.mockResolvedValue('user-1');

      const result = await service.verifyEmail('verify-token');

      expect(authTokens.consume).toHaveBeenCalledWith(
        'verify-token',
        'email_verify',
      );
      expect(users.setEmailVerified).toHaveBeenCalledWith('user-1');
      expect(result.message).toContain('Email verified');
    });
  });

  describe('resendVerification', () => {
    it('stays generic and sends nothing for unknown accounts', async () => {
      users.findByIdentifier.mockResolvedValue(null);

      const result = await service.resendVerification(
        'ghost@example.com',
        meta,
      );

      expect(result.message).toContain('If the account exists');
      expect(verification.sendVerificationTo).not.toHaveBeenCalled();
    });

    it('stays generic and sends nothing for already-verified accounts', async () => {
      users.findByIdentifier.mockResolvedValue(makeUser());

      await service.resendVerification('jane@example.com', meta);

      expect(verification.sendVerificationTo).not.toHaveBeenCalled();
    });

    it('issues a fresh link for unverified accounts', async () => {
      users.findByIdentifier.mockResolvedValue(
        makeUser({ emailVerifiedAt: null }),
      );

      await service.resendVerification('Jane@Example.com', meta);

      expect(rateLimiter.consume).toHaveBeenCalledWith(
        identifierLimitKey('resend', 'jane@example.com'),
        { limit: 3, windowSeconds: 3600 },
      );
      expect(rateLimiter.consume).toHaveBeenCalledWith(
        ipLimitKey('resend', '1.2.3.4'),
        { limit: 10, windowSeconds: 3600 },
      );
      expect(verification.sendVerificationTo).toHaveBeenCalledWith(
        'user-1',
        'jane@example.com',
      );
    });
  });
});

/** UsersService mock with per-method vi.fn()s. */
function createUsersMock() {
  return {
    existsByEmail: vi.fn(),
    existsByUsername: vi.fn(),
    findByIdentifier: vi.fn(),
    setEmailVerified: vi.fn().mockResolvedValue(undefined),
  };
}

/** UserProvisioningService mock with per-method vi.fn()s. */
function createProvisioningMock() {
  return {
    createUnverified: vi.fn(),
  };
}

/** AuthTokenService mock issuing a recognizable link token. */
function createAuthTokensMock() {
  return {
    issue: vi.fn().mockResolvedValue('link-token'),
    consume: vi.fn(),
  };
}

/** EmailVerificationService mock. */
function createVerificationMock() {
  return {
    sendVerificationTo: vi.fn().mockResolvedValue(undefined),
  };
}

/** RateLimiter mock (all limits pass). */
function createRateLimiterMock() {
  return {
    consume: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  };
}
