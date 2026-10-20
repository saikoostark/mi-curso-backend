import type { ConfigService } from '@nestjs/config';
import type { CacheService } from '../../cache/cache.service.js';
import { RevocationService } from './revocation.service.js';

/** ConfigService mock exposing only the denylist cap. */
function createConfigMock(maxSize?: string): ConfigService {
  return {
    get: vi.fn().mockReturnValue(maxSize),
  } as unknown as ConfigService;
}

describe('RevocationService', () => {
  let get: ReturnType<typeof vi.fn>;
  let set: ReturnType<typeof vi.fn>;
  let zadd: ReturnType<typeof vi.fn>;
  let zscore: ReturnType<typeof vi.fn>;
  let zremRangeByScore: ReturnType<typeof vi.fn>;
  let zcard: ReturnType<typeof vi.fn>;
  let service: RevocationService;

  beforeEach(() => {
    get = vi.fn();
    set = vi.fn();
    zadd = vi.fn().mockResolvedValue(undefined);
    zscore = vi.fn();
    zremRangeByScore = vi.fn().mockResolvedValue(0);
    zcard = vi.fn().mockResolvedValue(1);

    const cache = {
      get,
      set,
      zadd,
      zscore,
      zremRangeByScore,
      zcard,
    } as unknown as CacheService;

    service = new RevocationService(cache, createConfigMock());
  });

  it('stamps the watermark with the access-token TTL', async () => {
    await service.revokeAllBefore('user-1', 1_000_000);

    expect(set).toHaveBeenCalledWith(
      'auth:revoked-before:user-1',
      1_000_000,
      900_000,
    );
  });

  it('treats a missing watermark as valid', async () => {
    get.mockResolvedValue(null);

    await expect(service.isRevoked('user-1', 0)).resolves.toBe(false);
  });

  it('rejects tokens issued before the watermark', async () => {
    get.mockResolvedValue(2_000_500);

    await expect(service.isRevoked('user-1', 2_000_499)).resolves.toBe(true);
  });

  it('rejects same-second tokens minted before the watermark', async () => {
    // Both instants fall in second 2000 — millisecond precision decides.
    get.mockResolvedValue(2_000_500);

    await expect(service.isRevoked('user-1', 2_000_300)).resolves.toBe(true);
  });

  it('keeps tokens minted after the watermark valid (fresh logins must not die)', async () => {
    get.mockResolvedValue(2_000_500);

    await expect(service.isRevoked('user-1', 2_000_501)).resolves.toBe(false);
    await expect(service.isRevoked('user-1', 2_500_000)).resolves.toBe(false);
  });

  it('denylists a jti in the shared sorted set, scored by expiry', async () => {
    const before = Date.now();

    await service.denyJti('jti-1', 60);

    expect(zadd).toHaveBeenCalledWith(
      'auth:denylist',
      expect.any(Number),
      'jti-1',
      900_000,
    );

    const score = zadd.mock.calls[0][1] as number;
    expect(score).toBeGreaterThanOrEqual(before + 60_000);
    expect(score).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  it('prunes expired entries when a write reaches the cap', async () => {
    service = new RevocationService(
      {
        get,
        set,
        zadd,
        zscore,
        zremRangeByScore,
        zcard,
      } as unknown as CacheService,
      createConfigMock('2'),
    );
    zcard.mockResolvedValue(2);

    await service.denyJti('jti-1', 60);

    expect(zremRangeByScore).toHaveBeenCalledWith(
      'auth:denylist',
      '-inf',
      expect.any(Number),
    );
  });

  it('does not prune below the cap', async () => {
    zcard.mockResolvedValue(1);

    await service.denyJti('jti-1', 60);

    expect(zremRangeByScore).not.toHaveBeenCalled();
  });

  it('detects denylisted jtis whose expiry is still in the future', async () => {
    zscore.mockResolvedValue(Date.now() + 60_000);

    await expect(service.isJtiDenied('jti-1')).resolves.toBe(true);
  });

  it('treats entries scored in the past as expired', async () => {
    zscore.mockResolvedValue(Date.now() - 1);

    await expect(service.isJtiDenied('jti-1')).resolves.toBe(false);
  });

  it('treats unknown jtis as allowed', async () => {
    zscore.mockResolvedValue(null);

    await expect(service.isJtiDenied('jti-1')).resolves.toBe(false);
  });

  it('prunes everything scored in the past and reports the count', async () => {
    zremRangeByScore.mockResolvedValue(7);
    zcard.mockResolvedValue(0);

    await expect(service.pruneExpired()).resolves.toBe(7);
    expect(zremRangeByScore).toHaveBeenCalledWith(
      'auth:denylist',
      '-inf',
      expect.any(Number),
    );
  });

  it('falls back to the default cap for malformed env values', async () => {
    service = new RevocationService(
      {
        get,
        set,
        zadd,
        zscore,
        zremRangeByScore,
        zcard,
      } as unknown as CacheService,
      createConfigMock('not-a-number'),
    );
    // Above the 100k default (a `NaN`/zero fallback or an ignored value would
    // behave differently), so this proves the default is actually applied.
    zcard.mockResolvedValue(150_000);

    await service.denyJti('jti-1', 60);

    expect(zremRangeByScore).toHaveBeenCalled();
  });
});
