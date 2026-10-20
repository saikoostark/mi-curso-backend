import { Module } from '@nestjs/common';
import { FixedWindowRateLimiter } from './fixed-window-rate-limiter.js';
import { RateLimiter } from './rate-limiter.js';

/**
 * Binds the `RateLimiter` port to the fixed-window cache adapter.
 *
 * Consumers inject the abstraction and own their own rules; swapping the
 * mechanism — sliding window, Redis-native limiter — only changes the binding
 * below. Cache access comes from the global `CacheModule`.
 */
@Module({
  providers: [{ provide: RateLimiter, useClass: FixedWindowRateLimiter }],
  exports: [RateLimiter],
})
export class RateLimitModule {}
