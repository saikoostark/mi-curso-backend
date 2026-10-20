import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_AUDIT_LOG_RETENTION_DAYS } from '../../audit/audit.constants.js';
import { AuditService } from '../../audit/audit.service.js';
import { EmailChangeService } from '../auth/account/email-change.service.js';
import { AuthTokenService } from './auth-token.service.js';
import { RefreshTokenService } from './refresh-token.service.js';
import { RevocationService } from './revocation.service.js';
import { DEFAULT_CLEANUP_INTERVAL_MS } from './token.constants.js';

/**
 * Periodic housekeeping for token state.
 *
 * Every sweep:
 * - prunes expired entries from the Redis JTI denylist (live entries are never
 *   evicted — the cap is enforced in `RevocationService`),
 * - deletes `auth_tokens` rows a retention window past expiry,
 * - deletes `refresh_tokens` rows a retention window past expiry,
 * - deletes expired pending email-change requests (their approval tokens die in
 *   lockstep, so no retention window applies),
 * - deletes audit rows older than `AUDIT_LOG_RETENTION_DAYS` (default 365).
 *
 * The scheduler is a plain `setInterval` on purpose: one process owns a handful
 * of DELETEs every few minutes, so a job-queue dependency would be
 * over-engineering. The timer is `unref()`ed (never keeps the process alive)
 * and cleared on shutdown; a slow sweep cannot overlap itself.
 *
 * Interval: `AUTH_CLEANUP_INTERVAL_MS` (default 5 minutes).
 */
@Injectable()
export class TokenCleanupService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(TokenCleanupService.name);
  private readonly intervalMs: number;
  private readonly auditRetentionDays: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    config: ConfigService,
    private readonly revocation: RevocationService,
    private readonly authTokens: AuthTokenService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly emailChanges: EmailChangeService,
    private readonly audit: AuditService,
  ) {
    this.intervalMs = readPositiveInt(
      config.get<string>('AUTH_CLEANUP_INTERVAL_MS'),
      DEFAULT_CLEANUP_INTERVAL_MS,
    );
    this.auditRetentionDays = readPositiveInt(
      config.get<string>('AUDIT_LOG_RETENTION_DAYS'),
      DEFAULT_AUDIT_LOG_RETENTION_DAYS,
    );
  }

  /** Starts the periodic sweep. */
  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.runCleanup();
    }, this.intervalMs);
    // Housekeeping must never be the reason a process stays alive (tests,
    // `node dist/main` shutdown).
    this.timer.unref();
  }

  /** Stops the sweep when the application shuts down. */
  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Runs one cleanup pass.
   *
   * Public so specs can drive it deterministically instead of waiting for the
   * interval. Overlapping calls are ignored, and a failing sweep is logged
   * rather than crashing the process — the next tick retries.
   */
  async runCleanup(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      const prunedJtis = await this.revocation.pruneExpired();
      const purgedAuthTokens = await this.authTokens.purgeExpired();
      const purgedRefreshTokens = await this.refreshTokens.purgeExpired();
      const purgedEmailChanges = await this.emailChanges.purgeExpired();
      const purgedAuditLogs = await this.audit.purgeExpired(
        this.auditRetentionDays,
      );

      if (
        prunedJtis +
          purgedAuthTokens +
          purgedRefreshTokens +
          purgedEmailChanges +
          purgedAuditLogs >
        0
      ) {
        this.logger.log(
          `Token cleanup: ${prunedJtis} denylist entries, ` +
            `${purgedAuthTokens} auth tokens, ${purgedRefreshTokens} refresh tokens, ` +
            `${purgedEmailChanges} email-change requests, ` +
            `${purgedAuditLogs} audit rows removed.`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Token cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }
}

/**
 * Parses a positive integer from a raw env value.
 *
 * @param raw - Raw value, when present.
 * @param fallback - Value used when missing, empty, non-numeric or <= 0.
 * @returns The parsed value or the fallback.
 */
function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
