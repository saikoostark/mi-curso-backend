import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service.js';
import { RedisCacheService } from './redis-cache.service.js';

/**
 * Binds the cache port to its concrete adapter.
 *
 * Marked global (same pattern as `ConfigModule`) so feature modules can inject
 * `CacheService` without importing this module explicitly. Consumers always
 * depend on the abstraction; swapping Redis for another backend only changes
 * the binding below.
 */
@Global()
@Module({
  providers: [{ provide: CacheService, useClass: RedisCacheService }],
  exports: [CacheService],
})
export class CacheModule {}
