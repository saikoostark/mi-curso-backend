import { HttpException } from '@nestjs/common';
import type { CacheService } from '../cache/cache.service.js';
import { COMMON_ERROR_CODES } from '../common/http/error-codes.js';
import { FixedWindowRateLimiter } from './fixed-window-rate-limiter.js';
import type { RateLimitRule } from './rate-limiter.js';

describe('FixedWindowRateLimiter', () => {
  let increment: ReturnType<typeof vi.fn>;
  let deleteKey: ReturnType<typeof vi.fn>;
  let limiter: FixedWindowRateLimiter;

  const rule: RateLimitRule = { limit: 5, windowSeconds: 15 * 60 };

  beforeEach(() => {
    increment = vi.fn();
    deleteKey = vi.fn();

    const cache = {
      increment,
      delete: deleteKey,
    } as unknown as CacheService;

    limiter = new FixedWindowRateLimiter(cache);
  });

  it('increments the counter with the window as TTL', async () => {
    increment.mockResolvedValue(1);

    await limiter.consume('auth:rl:login:id:abc', rule);

    expect(increment).toHaveBeenCalledWith('auth:rl:login:id:abc', 900_000);
  });

  it('lets attempts within the limit pass', async () => {
    increment.mockResolvedValue(5);

    await expect(limiter.consume('key', rule)).resolves.toBeUndefined();
  });

  it('throws once the limit is exceeded', async () => {
    increment.mockResolvedValue(6);

    await expect(limiter.consume('key', rule)).rejects.toBeInstanceOf(
      HttpException,
    );
  });

  it('reports 429 with the rate_limited code', async () => {
    increment.mockResolvedValue(6);

    try {
      await limiter.consume('key', rule);
      throw new Error('consume should have thrown');
    } catch (error) {
      const exception = error as HttpException;
      expect(exception.getStatus()).toBe(429);
      expect(exception.getResponse()).toMatchObject({
        code: COMMON_ERROR_CODES.rateLimited,
      });
    }
  });

  it('clears the counter behind a key', async () => {
    await limiter.clear('key');

    expect(deleteKey).toHaveBeenCalledWith('key');
  });
});
