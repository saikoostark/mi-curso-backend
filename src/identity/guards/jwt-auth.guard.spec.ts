import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import type { RevocationService } from '../token/revocation.service.js';
import type { AccessTokenService } from '../token/access-token.service.js';
import { TOKEN_ERRORS } from '../token/token.error-codes.js';
import type { UsersService } from '../users/users.service.js';

/** Request shape used by the guard. */
interface GuardRequest {
  headers: Record<string, string | undefined>;
  user?: { id: string };
}

/** Minimal ExecutionContext wrapping a fake request. */
function contextFor(request: GuardRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

/** Runs the guard and returns the 401 body, failing when it resolves. */
async function unauthorizedBody(
  run: () => Promise<unknown>,
): Promise<Record<string, unknown>> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(UnauthorizedException);
    return (error as UnauthorizedException).getResponse() as Record<
      string,
      unknown
    >;
  }

  throw new Error('Expected UnauthorizedException');
}

describe('JwtAuthGuard', () => {
  let verifyAccessToken: ReturnType<typeof vi.fn>;
  let isJtiDenied: ReturnType<typeof vi.fn>;
  let isRevoked: ReturnType<typeof vi.fn>;
  let findById: ReturnType<typeof vi.fn>;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    verifyAccessToken = vi.fn();
    isJtiDenied = vi.fn().mockResolvedValue(false);
    isRevoked = vi.fn().mockResolvedValue(false);
    findById = vi.fn().mockResolvedValue({ id: 'user-1', isSuperuser: false });

    guard = new JwtAuthGuard(
      { verifyAccessToken } as unknown as AccessTokenService,
      { isJtiDenied, isRevoked } as unknown as RevocationService,
      { findById } as unknown as UsersService,
    );
  });

  it('rejects requests without an Authorization header', async () => {
    const request: GuardRequest = { headers: {} };

    const body = await unauthorizedBody(() =>
      guard.canActivate(contextFor(request)),
    );

    expect(body.code).toBe(TOKEN_ERRORS.missingToken);
  });

  it('rejects malformed Authorization headers', async () => {
    const request: GuardRequest = {
      headers: { authorization: 'Token abc.def.ghi' },
    };

    const body = await unauthorizedBody(() =>
      guard.canActivate(contextFor(request)),
    );

    expect(body.code).toBe(TOKEN_ERRORS.missingToken);
  });

  it('rejects tokens that fail verification', async () => {
    verifyAccessToken.mockRejectedValue(new Error('bad signature'));
    const request: GuardRequest = {
      headers: { authorization: 'Bearer broken' },
    };

    const body = await unauthorizedBody(() =>
      guard.canActivate(contextFor(request)),
    );

    expect(body.code).toBe(TOKEN_ERRORS.invalidToken);
  });

  it('rejects denylisted token ids', async () => {
    verifyAccessToken.mockResolvedValue({
      sub: 'user-1',
      jti: 'jti-1',
      iat: 100,
      iatMs: 100_500,
      exp: 200,
    });
    isJtiDenied.mockResolvedValue(true);
    const request: GuardRequest = {
      headers: { authorization: 'Bearer token' },
    };

    const body = await unauthorizedBody(() =>
      guard.canActivate(contextFor(request)),
    );

    expect(body.code).toBe(TOKEN_ERRORS.tokenRevoked);
  });

  it('rejects tokens older than the user watermark', async () => {
    verifyAccessToken.mockResolvedValue({
      sub: 'user-1',
      jti: 'jti-1',
      iat: 100,
      iatMs: 100_500,
      exp: 200,
    });
    isRevoked.mockResolvedValue(true);
    const request: GuardRequest = {
      headers: { authorization: 'Bearer token' },
    };

    const body = await unauthorizedBody(() =>
      guard.canActivate(contextFor(request)),
    );

    expect(body.code).toBe(TOKEN_ERRORS.tokenRevoked);
    expect(isRevoked).toHaveBeenCalledWith('user-1', 100_500);
  });

  it('accepts valid tokens and attaches the user to the request', async () => {
    verifyAccessToken.mockResolvedValue({
      sub: 'user-1',
      jti: 'jti-1',
      iat: 100,
      iatMs: 100_500,
      exp: 200,
    });
    const request: GuardRequest = {
      headers: { authorization: 'Bearer token' },
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.user).toEqual({
      id: 'user-1',
      isSuperuser: false,
      jti: 'jti-1',
      accessExpiresAtMs: 200_000,
    });
  });

  it('attaches the superuser flag from the account', async () => {
    verifyAccessToken.mockResolvedValue({
      sub: 'user-1',
      jti: 'jti-1',
      iat: 100,
      iatMs: 100_500,
      exp: 200,
    });
    findById.mockResolvedValue({ id: 'user-1', isSuperuser: true });
    const request: GuardRequest = {
      headers: { authorization: 'Bearer token' },
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.user).toEqual({
      id: 'user-1',
      isSuperuser: true,
      jti: 'jti-1',
      accessExpiresAtMs: 200_000,
    });
  });

  it('rejects valid tokens whose account no longer exists', async () => {
    verifyAccessToken.mockResolvedValue({
      sub: 'user-1',
      jti: 'jti-1',
      iat: 100,
      iatMs: 100_500,
      exp: 200,
    });
    findById.mockResolvedValue(null);
    const request: GuardRequest = {
      headers: { authorization: 'Bearer token' },
    };

    const body = await unauthorizedBody(() =>
      guard.canActivate(contextFor(request)),
    );

    expect(body.code).toBe(TOKEN_ERRORS.invalidToken);
  });

  it('accepts case-insensitive bearer schemes', async () => {
    verifyAccessToken.mockResolvedValue({
      sub: 'user-1',
      jti: 'jti-1',
      iat: 100,
      iatMs: 100_500,
      exp: 200,
    });
    const request: GuardRequest = {
      headers: { authorization: 'bEaReR token' },
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
  });
});
