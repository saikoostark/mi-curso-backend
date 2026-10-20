import { UnauthorizedException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { RefreshToken } from './entities/refresh-token.entity.js';
import { RefreshTokenService } from './refresh-token.service.js';
import type { RevocationService } from './revocation.service.js';
import { hashOpaqueToken } from './token.util.js';

/** Row factory for repository mocks. */
function makeRow(overrides: Partial<RefreshToken> = {}): RefreshToken {
  return {
    id: 'row-1',
    userId: 'user-1',
    tokenHash: 'stored-hash',
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    replacedByHash: null,
    accessJti: 'access-jti-1',
    accessExpiresAt: new Date(Date.now() + 60_000),
    userAgent: null,
    ip: null,
    lastUsedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  } as unknown as RefreshToken;
}

describe('RefreshTokenService', () => {
  let findOne: ReturnType<typeof vi.fn>;
  let find: ReturnType<typeof vi.fn>;
  let save: ReturnType<typeof vi.fn>;
  let create: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let deleteRows: ReturnType<typeof vi.fn>;
  let revokeAllBefore: ReturnType<typeof vi.fn>;
  let denyJti: ReturnType<typeof vi.fn>;
  let service: RefreshTokenService;

  const meta = { ip: '1.2.3.4', userAgent: 'vitest' };

  beforeEach(() => {
    findOne = vi.fn();
    find = vi.fn().mockResolvedValue([]);
    create = vi.fn((entity: unknown) => entity);
    save = vi
      .fn()
      .mockImplementation((entity: object) =>
        Promise.resolve({ ...entity, id: 'session-1' }),
      );
    update = vi.fn().mockResolvedValue({ affected: 1 });
    deleteRows = vi.fn().mockResolvedValue({ affected: 0 });
    revokeAllBefore = vi.fn().mockResolvedValue(undefined);
    denyJti = vi.fn().mockResolvedValue(undefined);

    service = new RefreshTokenService(
      {
        findOne,
        find,
        save,
        create,
        update,
        delete: deleteRows,
      } as unknown as Repository<RefreshToken>,
      { revokeAllBefore, denyJti } as unknown as RevocationService,
    );
  });

  it('stores only the hash and the access journal when issuing', async () => {
    const expiresAtMs = Date.now() + 60_000;
    const token = await service.issue('user-1', meta, {
      jti: 'jti-1',
      expiresAtMs,
    });

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const saved = save.mock.calls[0][0] as {
      tokenHash: string;
      userId: string;
      accessJti: string;
      accessExpiresAt: Date;
      lastUsedAt: Date;
    };
    expect(saved.userId).toBe('user-1');
    expect(saved.tokenHash).toHaveLength(64);
    expect(saved.tokenHash).toBe(hashOpaqueToken(token));
    expect(saved.tokenHash).not.toBe(token);
    expect(saved.accessJti).toBe('jti-1');
    expect(saved.accessExpiresAt.getTime()).toBe(expiresAtMs);
    expect(saved.lastUsedAt).toBeInstanceOf(Date);
  });

  it('rotates an active token into a fresh, hashed successor', async () => {
    findOne.mockResolvedValue(makeRow());
    update.mockResolvedValue({ affected: 1 });

    const result = await service.rotate('raw-token', meta);

    expect(result.userId).toBe('user-1');
    expect(result.sessionId).toBe('session-1');
    expect(result.token).not.toBe('raw-token');

    const claim = update.mock.calls[0][1] as {
      revokedAt: Date;
      replacedByHash: string;
    };
    expect(claim.revokedAt).toBeInstanceOf(Date);
    expect(claim.replacedByHash).toBe(hashOpaqueToken(result.token));

    // The access journal is attached after the caller signs the new token.
    const successor = save.mock.calls[0][0] as {
      tokenHash: string;
      accessJti: string | null;
    };
    expect(successor.tokenHash).toBe(hashOpaqueToken(result.token));
    expect(successor.accessJti).toBeNull();
  });

  it('rejects unknown tokens without touching the ledger', async () => {
    findOne.mockResolvedValue(null);

    await expect(service.rotate('ghost', meta)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(update).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('treats reuse of a rotated token as theft and revokes everything', async () => {
    findOne.mockResolvedValue(
      makeRow({ revokedAt: new Date(), replacedByHash: 'successor-hash' }),
    );

    await expect(service.rotate('replayed', meta)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    expect(revokeAllBefore).toHaveBeenCalledWith('user-1');
    expect(update).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  it('treats a stale token from an explicit logout as merely invalid', async () => {
    // Revoked without a successor (logout/revoke, not rotation): presenting it
    // must not revoke the devices the user is still signed in on.
    findOne.mockResolvedValue(makeRow({ revokedAt: new Date() }));

    await expect(service.rotate('logged-out', meta)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    expect(revokeAllBefore).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects expired tokens', async () => {
    findOne.mockResolvedValue(makeRow({ expiresAt: new Date(Date.now() - 1) }));

    await expect(service.rotate('stale', meta)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('treats a lost rotation race as theft', async () => {
    findOne.mockResolvedValue(makeRow());
    update.mockResolvedValue({ affected: 0 });

    await expect(service.rotate('raced', meta)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    expect(revokeAllBefore).toHaveBeenCalledWith('user-1');
    expect(save).not.toHaveBeenCalled();
  });

  it('links the access token to a rotated session', async () => {
    await service.attachAccess('session-1', {
      jti: 'jti-2',
      expiresAtMs: 1_800_000_000_000,
    });

    expect(update).toHaveBeenCalledWith(
      { id: 'session-1' },
      { accessJti: 'jti-2', accessExpiresAt: new Date(1_800_000_000_000) },
    );
  });

  it('lists active sessions newest first', async () => {
    const rows = [makeRow()];
    find.mockResolvedValue(rows);

    await expect(service.listActiveForUser('user-1')).resolves.toBe(rows);
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        order: { createdAt: 'DESC', id: 'DESC' },
      }),
    );
  });

  it('claims one session atomically and refuses stale rows', async () => {
    findOne.mockResolvedValue(makeRow());

    const row = await service.revokeSession('user-1', 'row-1');

    expect(row?.id).toBe('row-1');
    expect(update).toHaveBeenCalledWith(
      { id: 'row-1', revokedAt: expect.anything() },
      { revokedAt: expect.any(Date) },
    );
  });

  it('returns null for unknown, already-revoked, expired or raced sessions', async () => {
    findOne.mockResolvedValue(null);
    await expect(
      service.revokeSession('user-1', 'missing'),
    ).resolves.toBeNull();

    findOne.mockResolvedValue(makeRow({ revokedAt: new Date() }));
    await expect(service.revokeSession('user-1', 'row-1')).resolves.toBeNull();

    findOne.mockResolvedValue(makeRow({ expiresAt: new Date(Date.now() - 1) }));
    await expect(service.revokeSession('user-1', 'row-1')).resolves.toBeNull();

    findOne.mockResolvedValue(makeRow());
    update.mockResolvedValue({ affected: 0 });
    await expect(service.revokeSession('user-1', 'row-1')).resolves.toBeNull();
  });

  it('revokes the session behind a raw refresh token', async () => {
    findOne.mockResolvedValue(makeRow({ id: 'cookie-row' }));

    const row = await service.revokeByRawToken('raw-token');

    expect(row?.id).toBe('cookie-row');
    expect(findOne).toHaveBeenCalledWith({
      where: { tokenHash: hashOpaqueToken('raw-token') },
    });
    expect(update).toHaveBeenCalledWith(
      { id: 'cookie-row', revokedAt: expect.anything() },
      { revokedAt: expect.any(Date) },
    );
    expect(denyJti).toHaveBeenCalledWith('access-jti-1', expect.any(Number));
  });

  it('returns null when the refresh cookie cannot be revoked', async () => {
    findOne.mockResolvedValue(null);
    await expect(service.revokeByRawToken('ghost')).resolves.toBeNull();

    findOne.mockResolvedValue(makeRow({ revokedAt: new Date() }));
    await expect(service.revokeByRawToken('stale')).resolves.toBeNull();

    findOne.mockResolvedValue(makeRow({ expiresAt: new Date(Date.now() - 1) }));
    await expect(service.revokeByRawToken('expired')).resolves.toBeNull();

    findOne.mockResolvedValue(makeRow());
    update.mockResolvedValue({ affected: 0 });
    await expect(service.revokeByRawToken('raced')).resolves.toBeNull();
  });

  it('evicts the oldest sessions above the active-session cap', async () => {
    const active = Array.from({ length: 12 }, (_, index) =>
      makeRow({
        id: `row-${index}`,
        accessJti: `jti-${index}`,
        accessExpiresAt: new Date(Date.now() + 60_000),
      }),
    );
    find.mockResolvedValue(active);

    await expect(service.enforceLimit('user-1', 10)).resolves.toBe(2);

    // `listActiveForUser` is newest first, so only the last two are evicted.
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith(
      { id: 'row-10', revokedAt: expect.anything() },
      { revokedAt: expect.any(Date) },
    );
    expect(update).toHaveBeenCalledWith(
      { id: 'row-11', revokedAt: expect.anything() },
      { revokedAt: expect.any(Date) },
    );
    expect(denyJti).toHaveBeenCalledWith('jti-10', expect.any(Number));
    expect(denyJti).toHaveBeenCalledWith('jti-11', expect.any(Number));
  });

  it('does nothing for a non-positive session cap', async () => {
    await expect(service.enforceLimit('user-1', 0)).resolves.toBe(0);
    expect(find).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('revokes every session except the caller and denylists their tokens', async () => {
    const current = makeRow({
      id: 'current',
      accessJti: 'current-jti',
      accessExpiresAt: new Date(Date.now() + 60_000),
    });
    const other = makeRow({
      id: 'other',
      accessJti: 'other-jti',
      accessExpiresAt: new Date(Date.now() + 30_000),
    });
    const expiredAccess = makeRow({
      id: 'expired-access',
      accessJti: 'dead-jti',
      accessExpiresAt: new Date(Date.now() - 1),
    });
    find.mockResolvedValue([current, other, expiredAccess]);

    const revoked = await service.revokeOtherSessions('user-1', 'current-jti');

    expect(revoked).toBe(2);
    // Only the two non-current rows are revoked and denylisted (the expired
    // access token has nothing left to deny).
    expect(denyJti).toHaveBeenCalledTimes(1);
    expect(denyJti).toHaveBeenCalledWith('other-jti', expect.any(Number));
    expect(denyJti).not.toHaveBeenCalledWith('current-jti', expect.anything());
  });

  it('keeps the caller alive when a session has no access journal', async () => {
    find.mockResolvedValue([
      makeRow({ id: 'legacy', accessJti: null, accessExpiresAt: null }),
    ]);

    await service.revokeOtherSessions('user-1', 'current-jti');

    expect(denyJti).not.toHaveBeenCalled();
  });

  it('denylists a session access token for its remaining lifetime', async () => {
    await service.denyAccessTokenOf(
      makeRow({ accessExpiresAt: new Date(Date.now() + 10_000) }),
    );
    expect(denyJti).toHaveBeenCalledWith('access-jti-1', expect.any(Number));

    denyJti.mockClear();
    await service.denyAccessTokenOf(makeRow({ accessJti: null }));
    await service.denyAccessTokenOf(
      makeRow({ accessExpiresAt: new Date(Date.now() - 1) }),
    );
    expect(denyJti).not.toHaveBeenCalled();
  });

  it('revokes all of a user’s tokens and stamps the watermark', async () => {
    await service.revokeAllForUser('user-1');

    expect(update).toHaveBeenCalledWith(
      { userId: 'user-1', revokedAt: expect.anything() },
      { revokedAt: expect.any(Date) },
    );
    expect(revokeAllBefore).toHaveBeenCalledWith('user-1');
  });

  it('purges all rows of a deleted account', async () => {
    await service.purgeForUser('user-1');

    expect(deleteRows).toHaveBeenCalledWith({ userId: 'user-1' });
  });

  it('purges rows past the retention window', async () => {
    deleteRows.mockResolvedValue({ affected: 3 });

    await expect(service.purgeExpired()).resolves.toBe(3);
    expect(deleteRows).toHaveBeenCalledWith({
      expiresAt: expect.anything(),
    });
  });
});
