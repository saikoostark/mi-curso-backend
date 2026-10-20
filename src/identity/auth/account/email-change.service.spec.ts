import { HttpException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { RateLimiter } from '../../../rate-limit/rate-limiter.js';
import type { PasswordService } from '../../password/password.service.js';
import type { AuthTokenService } from '../../token/auth-token.service.js';
import type { RefreshTokenService } from '../../token/refresh-token.service.js';
import type { User } from '../../users/user.entity.js';
import type { UsersService } from '../../users/users.service.js';
import { AUTH_ERRORS } from '../auth.error-codes.js';
import type { AuthMailerService } from '../auth-mailer.service.js';
import type { RequestMeta } from '../auth.types.js';
import type { EmailVerificationService } from '../email-verification.service.js';
import { EmailChangeService } from './email-change.service.js';
import type { EmailChangeRequest } from './entities/email-change-request.entity.js';

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
  };
}

/** Pending request factory for test data. */
function makePending(
  overrides: Partial<EmailChangeRequest> = {},
): EmailChangeRequest {
  return {
    id: 'request-1',
    userId: 'user-1',
    newEmail: 'new@example.com',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  } as EmailChangeRequest;
}

/** Runs the call and returns the HTTP status/body, failing when it resolves. */
async function httpError(run: () => Promise<unknown>): Promise<{
  status: number;
  body: Record<string, unknown> & {
    code?: string;
    message?: string;
  };
}> {
  try {
    await run();
  } catch (error) {
    if (error instanceof HttpException) {
      return {
        status: error.getStatus(),
        body: error.getResponse() as Record<string, unknown> & {
          code?: string;
        },
      };
    }

    throw error;
  }

  throw new Error('Expected the call to reject');
}

describe('EmailChangeService', () => {
  let findOne: ReturnType<typeof vi.fn>;
  let upsert: ReturnType<typeof vi.fn>;
  let deleteRequests: ReturnType<typeof vi.fn>;
  let findById: ReturnType<typeof vi.fn>;
  let findByEmail: ReturnType<typeof vi.fn>;
  let save: ReturnType<typeof vi.fn>;
  let verifyPassword: ReturnType<typeof vi.fn>;
  let issue: ReturnType<typeof vi.fn>;
  let consume: ReturnType<typeof vi.fn>;
  let previewToken: ReturnType<typeof vi.fn>;
  let invalidatePending: ReturnType<typeof vi.fn>;
  let revokeAllForUser: ReturnType<typeof vi.fn>;
  let sendVerificationTo: ReturnType<typeof vi.fn>;
  let sendEmailChangeApproval: ReturnType<typeof vi.fn>;
  let consumeRateLimit: ReturnType<typeof vi.fn>;
  let service: EmailChangeService;

  const meta: RequestMeta = { ip: '1.2.3.4', userAgent: 'vitest' };
  const dto = { email: 'new@example.com', password: 'Str0ngPassw' };

  beforeEach(() => {
    findOne = vi.fn().mockResolvedValue(null);
    upsert = vi.fn().mockResolvedValue(undefined);
    deleteRequests = vi.fn().mockResolvedValue({ affected: 0 });
    findById = vi.fn().mockResolvedValue(makeUser());
    findByEmail = vi.fn().mockResolvedValue(null);
    save = vi.fn().mockImplementation((user: User) => Promise.resolve(user));
    verifyPassword = vi.fn().mockResolvedValue(true);
    issue = vi.fn().mockResolvedValue('approval-token');
    consume = vi.fn().mockResolvedValue('user-1');
    previewToken = vi.fn().mockResolvedValue('user-1');
    invalidatePending = vi.fn().mockResolvedValue(undefined);
    revokeAllForUser = vi.fn().mockResolvedValue(undefined);
    sendVerificationTo = vi.fn().mockResolvedValue(undefined);
    sendEmailChangeApproval = vi.fn().mockResolvedValue(undefined);
    consumeRateLimit = vi.fn().mockResolvedValue(undefined);

    service = new EmailChangeService(
      {
        findOne,
        upsert,
        delete: deleteRequests,
      } as unknown as Repository<EmailChangeRequest>,
      {
        findById,
        findByEmail,
        save,
      } as unknown as UsersService,
      { verify: verifyPassword } as unknown as PasswordService,
      {
        issue,
        consume,
        preview: previewToken,
        invalidatePending,
      } as unknown as AuthTokenService,
      { revokeAllForUser } as unknown as RefreshTokenService,
      { sendVerificationTo } as unknown as EmailVerificationService,
      { sendEmailChangeApproval } as unknown as AuthMailerService,
      { consume: consumeRateLimit } as unknown as RateLimiter,
    );
  });

  it('rate-limits per account and per IP before checking the password', async () => {
    verifyPassword.mockResolvedValue(false);

    await httpError(() => service.request('user-1', dto, meta));

    expect(consumeRateLimit).toHaveBeenCalledTimes(2);
    expect(verifyPassword).toHaveBeenCalledWith('Str0ngPassw', 'stored-hash');
  });

  it('rejects a wrong current password', async () => {
    verifyPassword.mockResolvedValue(false);

    const error = await httpError(() => service.request('user-1', dto, meta));

    expect(error.status).toBe(400);
    expect(error.body.code).toBe(AUTH_ERRORS.invalidCurrentPassword);
    expect(upsert).not.toHaveBeenCalled();
    expect(sendEmailChangeApproval).not.toHaveBeenCalled();
  });

  it('rejects an unchanged email', async () => {
    const error = await httpError(() =>
      service.request('user-1', { ...dto, email: ' JANE@example.com ' }, meta),
    );

    expect(error.status).toBe(400);
    expect(error.body.code).toBe('email_unchanged');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rejects an address owned by another active account', async () => {
    findByEmail.mockResolvedValue(makeUser({ id: 'user-2' }));

    const error = await httpError(() => service.request('user-1', dto, meta));

    expect(error.status).toBe(409);
    expect(error.body.code).toBe('email_taken');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('keeps a verified account on its old address until the owner approves', async () => {
    const result = await service.request('user-1', dto, meta);

    expect(result).toEqual({
      message: 'Approval email sent to your current address.',
      sessionsRevoked: false,
    });
    expect(upsert).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        newEmail: 'new@example.com',
        expiresAt: expect.any(Date),
      },
      ['userId'],
    );
    expect(issue).toHaveBeenCalledWith(
      'user-1',
      'email_change_old',
      expect.any(Number),
    );
    expect(sendEmailChangeApproval).toHaveBeenCalledWith(
      'jane@example.com',
      'new@example.com',
      'approval-token',
    );
    // Nothing changed yet: no save, no verification, no session revocation.
    expect(save).not.toHaveBeenCalled();
    expect(sendVerificationTo).not.toHaveBeenCalled();
    expect(revokeAllForUser).not.toHaveBeenCalled();
  });

  it('switches an unverified account immediately and starts verification', async () => {
    findById.mockResolvedValue(makeUser({ emailVerifiedAt: null }));

    const result = await service.request('user-1', dto, meta);

    expect(result.sessionsRevoked).toBe(true);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'new@example.com',
        emailVerifiedAt: null,
      }),
    );
    expect(revokeAllForUser).toHaveBeenCalledWith('user-1');
    expect(sendVerificationTo).toHaveBeenCalledWith(
      'user-1',
      'new@example.com',
    );
    expect(deleteRequests).toHaveBeenCalledWith({ userId: 'user-1' });
    expect(invalidatePending).toHaveBeenCalledWith(
      'user-1',
      'email_change_old',
    );
    expect(invalidatePending).toHaveBeenCalledWith('user-1', 'password_reset');
    // No approval handshake is needed for an unconfirmed address.
    expect(sendEmailChangeApproval).not.toHaveBeenCalled();
    expect(issue).not.toHaveBeenCalled();
  });

  it('maps a registration race on the immediate path to 409', async () => {
    findById.mockResolvedValue(makeUser({ emailVerifiedAt: null }));
    save.mockRejectedValue({
      code: '23505',
      constraint: 'uq_users_email_active',
    });

    const error = await httpError(() => service.request('user-1', dto, meta));

    expect(error.status).toBe(409);
    expect(error.body.code).toBe('email_taken');
    expect(revokeAllForUser).not.toHaveBeenCalled();
  });

  it('cancels a pending change and kills its approval link', async () => {
    const result = await service.cancel('user-1');

    expect(result.message).toContain('cancelled');
    expect(deleteRequests).toHaveBeenCalledWith({ userId: 'user-1' });
    expect(invalidatePending).toHaveBeenCalledWith(
      'user-1',
      'email_change_old',
    );
  });

  it('exposes a usable pending change and hides expired ones', async () => {
    findOne.mockResolvedValueOnce(makePending());

    await expect(service.getPending('user-1')).resolves.toEqual({
      newEmail: 'new@example.com',
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: expect.any(String),
    });

    findOne.mockResolvedValueOnce(
      makePending({ expiresAt: new Date(Date.now() - 1) }),
    );

    await expect(service.getPending('user-1')).resolves.toBeNull();
  });

  it('previews an approval link without consuming it', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    findOne.mockResolvedValue(makePending({ expiresAt }));

    const view = await service.preview('approval-token', meta);

    expect(previewToken).toHaveBeenCalledWith(
      'approval-token',
      'email_change_old',
    );
    expect(consume).not.toHaveBeenCalled();
    expect(view.newEmail).toBe('new@example.com');
    expect(view.expiresAt).toBe(expiresAt.toISOString());
    // The preview shares the per-IP approval budget.
    expect(consumeRateLimit).toHaveBeenCalledWith(
      expect.stringContaining('emailapprove'),
      expect.any(Object),
    );
  });

  it('rejects a preview when the pending handshake is gone', async () => {
    findOne.mockResolvedValue(null);

    const error = await httpError(() =>
      service.preview('approval-token', meta),
    );

    expect(error.status).toBe(400);
    expect(error.body.code).toBe('invalid_token');
    expect(consume).not.toHaveBeenCalled();
  });

  it('approves a pending change: swaps unverified and revokes sessions', async () => {
    findOne.mockResolvedValue(makePending());

    const result = await service.approve('approval-token', meta);

    expect(consume).toHaveBeenCalledWith('approval-token', 'email_change_old');
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'new@example.com',
        emailVerifiedAt: null,
      }),
    );
    expect(deleteRequests).toHaveBeenCalledWith({ userId: 'user-1' });
    expect(invalidatePending).toHaveBeenCalledWith(
      'user-1',
      'email_change_old',
    );
    expect(invalidatePending).toHaveBeenCalledWith('user-1', 'password_reset');
    expect(revokeAllForUser).toHaveBeenCalledWith('user-1');
    expect(sendVerificationTo).toHaveBeenCalledWith(
      'user-1',
      'new@example.com',
    );
    expect(result.message).toContain('Email updated');
  });

  it('rejects an approval without a pending request', async () => {
    const error = await httpError(() =>
      service.approve('approval-token', meta),
    );

    expect(error.status).toBe(400);
    expect(error.body.code).toBe('invalid_token');
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects and drops an expired pending request', async () => {
    findOne.mockResolvedValue(
      makePending({ expiresAt: new Date(Date.now() - 1) }),
    );

    const error = await httpError(() =>
      service.approve('approval-token', meta),
    );

    expect(error.status).toBe(400);
    expect(deleteRequests).toHaveBeenCalledWith({ id: 'request-1' });
    expect(save).not.toHaveBeenCalled();
  });

  it('reports a new-address collision at approval time', async () => {
    findOne.mockResolvedValue(makePending());
    findByEmail.mockResolvedValue(makeUser({ id: 'user-2' }));

    const error = await httpError(() =>
      service.approve('approval-token', meta),
    );

    expect(error.status).toBe(409);
    expect(error.body.code).toBe('email_taken');
    expect(deleteRequests).toHaveBeenCalledWith({ id: 'request-1' });
    expect(save).not.toHaveBeenCalled();
  });

  it('purges the pending request when the account is deleted', async () => {
    await service.purgeForUser('user-1');

    expect(deleteRequests).toHaveBeenCalledWith({ userId: 'user-1' });
    expect(invalidatePending).toHaveBeenCalledWith(
      'user-1',
      'email_change_old',
    );
  });

  it('purges expired requests without touching live ones', async () => {
    deleteRequests.mockResolvedValue({ affected: 4 });

    await expect(service.purgeExpired()).resolves.toBe(4);
    expect(deleteRequests).toHaveBeenCalledWith({
      expiresAt: expect.anything(),
    });
  });
});
