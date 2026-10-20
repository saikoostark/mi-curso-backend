import { HttpException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { TOKEN_ERRORS } from './token.error-codes.js';
import { hashOpaqueToken } from './token.util.js';
import { AuthTokenService } from './auth-token.service.js';
import type { AuthToken } from './entities/auth-token.entity.js';

/** Runs the call and returns the HTTP status/body, failing when it resolves. */
async function httpError(run: () => Promise<unknown>): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  try {
    await run();
  } catch (error) {
    if (error instanceof HttpException) {
      return {
        status: error.getStatus(),
        body: error.getResponse() as Record<string, unknown>,
      };
    }
    throw error;
  }

  throw new Error('Expected the call to reject');
}

describe('AuthTokenService', () => {
  let query: ReturnType<typeof vi.fn>;
  let findOne: ReturnType<typeof vi.fn>;
  let service: AuthTokenService;

  beforeEach(() => {
    query = vi.fn();
    findOne = vi.fn();
    service = new AuthTokenService({
      query,
      findOne,
    } as unknown as Repository<AuthToken>);
  });

  it('claims a token with one conditional UPDATE ... RETURNING', async () => {
    // PostgresQueryRunner wraps UPDATE results as `[rows, affected]`.
    query.mockResolvedValue([[{ userId: 'user-1' }], 1]);

    await expect(service.consume('raw-token', 'password_reset')).resolves.toBe(
      'user-1',
    );

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('UPDATE "auth_tokens"');
    expect(sql).toContain('"consumedAt" IS NULL');
    expect(sql).toContain('"expiresAt" > now()');
    expect(sql).toContain('RETURNING "userId"');
    expect(parameters).toEqual([
      hashOpaqueToken('raw-token'),
      'password_reset',
    ]);
  });

  it('rejects when the conditional update matches no usable row', async () => {
    query.mockResolvedValue([]);

    const error = await httpError(() =>
      service.consume('raw-token', 'password_reset'),
    );

    expect(error.status).toBe(400);
    expect(error.body.code).toBe(TOKEN_ERRORS.invalidToken);
  });

  it('previews a usable token without writing', async () => {
    findOne.mockResolvedValue({
      userId: 'user-1',
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      service.preview('raw-token', 'email_change_old'),
    ).resolves.toBe('user-1');
    expect(findOne).toHaveBeenCalledWith({
      where: {
        tokenHash: hashOpaqueToken('raw-token'),
        type: 'email_change_old',
      },
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects previews of consumed, expired or unknown tokens', async () => {
    const cases = [
      null,
      {
        userId: 'user-1',
        consumedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      },
      {
        userId: 'user-1',
        consumedAt: null,
        expiresAt: new Date(Date.now() - 1),
      },
    ];

    for (const row of cases) {
      findOne.mockResolvedValueOnce(row);
      const error = await httpError(() =>
        service.preview('raw-token', 'email_change_old'),
      );
      expect(error.status).toBe(400);
      expect(error.body.code).toBe(TOKEN_ERRORS.invalidToken);
    }
  });
});
