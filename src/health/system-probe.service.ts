import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../cache/cache.service.js';
import { DataSource } from 'typeorm';

/** Outcome of one dependency probe. */
export interface DependencyCheck {
  /** `up` when the check completed inside the timeout. */
  status: 'up' | 'down';
  /** Round-trip time in milliseconds. */
  latencyMs: number;
}

/** Readiness payload shared by `/ready` and `/metrics`. */
export interface ReadinessReport {
  status: 'ready' | 'not_ready';
  checks: {
    database: DependencyCheck;
    redis: DependencyCheck;
  };
  timestamp: string;
}

/** Maximum time a dependency check may take before it counts as down. */
const PROBE_TIMEOUT_MS = 2_000;

/**
 * Probes the dependencies that cannot be inferred from process liveness.
 *
 * `/health` intentionally stays a liveness-only probe; this service backs the
 * readiness endpoint and the dependency section of the metrics payload. Both
 * checks are bounded by a timeout so a hung connection cannot hang the probe.
 */
@Injectable()
export class SystemProbeService {
  private readonly logger = new Logger(SystemProbeService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly cache: CacheService,
  ) {}

  /**
   * Runs both dependency checks concurrently.
   *
   * @returns The readiness report; `not_ready` when any check is down.
   */
  async check(): Promise<ReadinessReport> {
    const [database, redis] = await Promise.all([
      this.measure('database', () => this.dataSource.query('SELECT 1')),
      this.measure('redis', () => this.cache.ping()),
    ]);

    return {
      status:
        database.status === 'up' && redis.status === 'up'
          ? 'ready'
          : 'not_ready',
      checks: { database, redis },
      timestamp: new Date().toISOString(),
    };
  }

  /** Measures one check and converts failures/timeouts into `down`. */
  private async measure(
    name: string,
    check: () => Promise<unknown>,
  ): Promise<DependencyCheck> {
    const startedAt = performance.now();

    try {
      await withTimeout(check(), PROBE_TIMEOUT_MS);
      return {
        status: 'up',
        latencyMs: Math.round(performance.now() - startedAt),
      };
    } catch (error) {
      this.logger.warn(
        `${name} probe failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        status: 'down',
        latencyMs: Math.round(performance.now() - startedAt),
      };
    }
  }
}

/**
 * Rejects when the promise does not settle inside `timeoutMs`.
 *
 * The timer is unref'ed and cleared on settlement so probes never keep the
 * process alive.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    timer.unref();
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
