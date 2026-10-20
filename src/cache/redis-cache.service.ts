import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from 'redis';
import { CacheService } from './cache.service.js';

/**
 * Redis implementation of the `CacheService` port.
 *
 * Owns the application-wide Redis client: the connection is established during
 * `onModuleInit` (so boot fails loudly when Redis is unreachable) and closed on
 * application shutdown. This is the only file importing node-redis — every
 * consumer depends on `CacheService` instead.
 */
@Injectable()
export class RedisCacheService
  extends CacheService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(RedisCacheService.name);
  private readonly client: ReturnType<typeof createClient>;

  constructor(config: ConfigService) {
    super();

    this.client = createClient({
      url: config.getOrThrow<string>('REDIS_URL'),
    });

    // node-redis emits 'error' for connection problems; without a listener the
    // event would crash the process instead of being logged.
    this.client.on('error', (error: Error) => {
      this.logger.error(`Redis client error: ${error.message}`);
    });
  }

  /** Connects to Redis when the application boots. */
  async onModuleInit(): Promise<void> {
    if (!this.client.isOpen) {
      await this.client.connect();
    }
  }

  /** Gracefully closes the connection when the application shuts down. */
  async onApplicationShutdown(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }

  /** @inheritdoc */
  async ping(): Promise<void> {
    await this.client.ping();
  }

  /** @inheritdoc */
  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  }

  /** @inheritdoc */
  async set(key: string, value: unknown, ttlMs: number): Promise<void> {
    await this.client.pSetEx(key, ttlMs, JSON.stringify(value));
  }

  /** @inheritdoc */
  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  /** @inheritdoc */
  async increment(key: string, ttlMs: number): Promise<number> {
    const value = await this.client.incr(key);
    if (value === 1) {
      // Applied only on creation: a later increment never extends the window.
      await this.client.pExpire(key, ttlMs);
    }

    return value;
  }

  /** @inheritdoc */
  async ttlMs(key: string): Promise<number | null> {
    // pTTL returns -2 for missing keys and -1 for keys without a TTL.
    const remaining = await this.client.pTTL(key);
    return remaining < 0 ? null : remaining;
  }

  /** @inheritdoc */
  async zadd(
    key: string,
    score: number,
    member: string,
    ttlMs: number,
  ): Promise<void> {
    await this.client.zAdd(key, { score, value: member });
    // Members outlive the key only up to their own score, and every write
    // re-extends the TTL past the newest score, so an idle key can expire
    // without dropping a still-live member.
    await this.client.pExpire(key, ttlMs);
  }

  /** @inheritdoc */
  async zscore(key: string, member: string): Promise<number | null> {
    const score = await this.client.zScore(key, member);
    return score === null ? null : score;
  }

  /** @inheritdoc */
  async zremRangeByScore(
    key: string,
    min: number | '-inf',
    max: number | '+inf',
  ): Promise<number> {
    return this.client.zRemRangeByScore(key, min, max);
  }

  /** @inheritdoc */
  async zcard(key: string): Promise<number> {
    return this.client.zCard(key);
  }
}
