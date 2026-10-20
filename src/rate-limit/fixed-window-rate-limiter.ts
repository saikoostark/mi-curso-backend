import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CacheService } from '../cache/cache.service.js';
import { COMMON_ERROR_CODES } from '../common/http/error-codes.js';
import type { RateLimitRule } from './rate-limiter.js';
import { RateLimiter } from './rate-limiter.js';

/**
 * Cache-backed fixed-window rate limiter.
 *
 * Counters are incremented on every attempt; the window TTL is applied when
 * the counter is first created, so later activity never extends the window.
 * A counter that exceeds its rule rejects the attempt with HTTP 429
 * `rate_limited`.
 */
@Injectable()
export class FixedWindowRateLimiter extends RateLimiter {
  constructor(private readonly cache: CacheService) {
    super();
  }

  /**
   * Increments the counter and throws 429 once the window limit is exceeded.
   *
   * @param key - Counter key.
   * @param rule - Limit and window the counter is measured against.
   */
  async consume(key: string, rule: RateLimitRule): Promise<void> {
    const attempts = await this.cache.increment(key, rule.windowSeconds * 1000);

    if (attempts > rule.limit) {
      throw new HttpException(
        {
          code: COMMON_ERROR_CODES.rateLimited,
          message: 'Too many attempts. Try again later.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Removes the counter behind a key.
   *
   * @param key - Counter key.
   */
  async clear(key: string): Promise<void> {
    await this.cache.delete(key);
  }
}
