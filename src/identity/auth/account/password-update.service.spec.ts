import { HttpException } from '@nestjs/common';
import { PASSWORD_ERRORS } from '../../password/password.error-codes.js';
import { PasswordService } from '../../password/password.service.js';
import type { AuthTokenService } from '../../token/auth-token.service.js';
import type { RefreshTokenService } from '../../token/refresh-token.service.js';
import type { User } from '../../users/user.entity.js';
import type { UsersService } from '../../users/users.service.js';
import type { EmailChangeService } from './email-change.service.js';
import { PasswordUpdateService } from './password-update.service.js';

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

describe('PasswordUpdateService', () => {
  let passwords: PasswordService;
  let updatePasswordHash: ReturnType<typeof vi.fn>;
  let invalidatePending: ReturnType<typeof vi.fn>;
  let revokeAllForUser: ReturnType<typeof vi.fn>;
  let purgeEmailChange: ReturnType<typeof vi.fn>;
  let service: PasswordUpdateService;

  beforeEach(() => {
    passwords = new PasswordService();
    vi.spyOn(passwords, 'hash').mockResolvedValue('new-hash');
    updatePasswordHash = vi.fn().mockResolvedValue(undefined);
    invalidatePending = vi.fn().mockResolvedValue(undefined);
    revokeAllForUser = vi.fn().mockResolvedValue(undefined);
    purgeEmailChange = vi.fn().mockResolvedValue(undefined);

    service = new PasswordUpdateService(
      { updatePasswordHash } as unknown as UsersService,
      passwords,
      { invalidatePending } as unknown as AuthTokenService,
      { revokeAllForUser } as unknown as RefreshTokenService,
      { purgeForUser: purgeEmailChange } as unknown as EmailChangeService,
    );
  });

  it('stores the new hash and revokes every session', async () => {
    await service.updatePassword(
      makeUser(),
      'NewStr0ngPassw',
      'NewStr0ngPassw',
    );

    expect(updatePasswordHash).toHaveBeenCalledWith('user-1', 'new-hash');
    expect(invalidatePending).toHaveBeenCalledWith('user-1', 'password_reset');
    expect(purgeEmailChange).toHaveBeenCalledWith('user-1');
    expect(revokeAllForUser).toHaveBeenCalledWith('user-1');
  });

  it('rejects mismatched confirmations before touching state', async () => {
    const body = await httpErrorBody(
      () =>
        service.updatePassword(
          makeUser(),
          'NewStr0ngPassw',
          'OtherStr0ng1Pass',
        ),
      400,
    );

    expect(body.code).toBe(PASSWORD_ERRORS.passwordMismatch);
    expect(updatePasswordHash).not.toHaveBeenCalled();
    expect(revokeAllForUser).not.toHaveBeenCalled();
  });

  it("enforces the policy against the user's own identifiers", async () => {
    const body = await httpErrorBody(
      () =>
        service.updatePassword(makeUser(), 'Janedoe1Passw', 'Janedoe1Passw'),
      400,
    );

    expect(body.code).toBe(PASSWORD_ERRORS.passwordPolicy);
    expect(body.message).toEqual(
      expect.arrayContaining([expect.stringContaining('username')]),
    );
    expect(updatePasswordHash).not.toHaveBeenCalled();
  });
});
