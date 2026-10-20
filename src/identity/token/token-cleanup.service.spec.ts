import type { ConfigService } from '@nestjs/config';
import type { AuditService } from '../../audit/audit.service.js';
import type { EmailChangeService } from '../auth/account/email-change.service.js';
import type { AuthTokenService } from './auth-token.service.js';
import type { RefreshTokenService } from './refresh-token.service.js';
import type { RevocationService } from './revocation.service.js';
import { TokenCleanupService } from './token-cleanup.service.js';

/** ConfigService mock exposing the cleanup interval and audit retention. */
function createConfigMock(
  intervalMs?: string,
  auditRetentionDays?: string,
): ConfigService {
  return {
    get: vi.fn((key: string) => {
      if (key === 'AUTH_CLEANUP_INTERVAL_MS') {
        return intervalMs;
      }
      if (key === 'AUDIT_LOG_RETENTION_DAYS') {
        return auditRetentionDays;
      }
      return undefined;
    }),
  } as unknown as ConfigService;
}

describe('TokenCleanupService', () => {
  let pruneExpired: ReturnType<typeof vi.fn>;
  let purgeAuthTokens: ReturnType<typeof vi.fn>;
  let purgeRefreshTokens: ReturnType<typeof vi.fn>;
  let purgeEmailChanges: ReturnType<typeof vi.fn>;
  let purgeAuditLogs: ReturnType<typeof vi.fn>;
  let service: TokenCleanupService;

  beforeEach(() => {
    pruneExpired = vi.fn().mockResolvedValue(0);
    purgeAuthTokens = vi.fn().mockResolvedValue(0);
    purgeRefreshTokens = vi.fn().mockResolvedValue(0);
    purgeEmailChanges = vi.fn().mockResolvedValue(0);
    purgeAuditLogs = vi.fn().mockResolvedValue(0);

    service = new TokenCleanupService(
      createConfigMock(),
      { pruneExpired } as unknown as RevocationService,
      { purgeExpired: purgeAuthTokens } as unknown as AuthTokenService,
      { purgeExpired: purgeRefreshTokens } as unknown as RefreshTokenService,
      { purgeExpired: purgeEmailChanges } as unknown as EmailChangeService,
      { purgeExpired: purgeAuditLogs } as unknown as AuditService,
    );
  });

  afterEach(() => {
    service.onApplicationShutdown();
    vi.useRealTimers();
  });

  it('runs every cleanup task in one sweep', async () => {
    await service.runCleanup();

    expect(pruneExpired).toHaveBeenCalledTimes(1);
    expect(purgeAuthTokens).toHaveBeenCalledTimes(1);
    expect(purgeRefreshTokens).toHaveBeenCalledTimes(1);
    expect(purgeEmailChanges).toHaveBeenCalledTimes(1);
    // Default retention: 365 days.
    expect(purgeAuditLogs).toHaveBeenCalledWith(365);
  });

  it('swallows failures so the process keeps running', async () => {
    pruneExpired.mockRejectedValue(new Error('redis down'));

    await expect(service.runCleanup()).resolves.toBeUndefined();
    // A failed sweep still reports the error and stops cleanly; the next timer
    // tick retries.
    expect(purgeAuthTokens).not.toHaveBeenCalled();
  });

  it('never overlaps two sweeps', async () => {
    let release: (value: number) => void = () => undefined;
    pruneExpired.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          release = resolve;
        }),
    );

    const first = service.runCleanup();
    await service.runCleanup();

    expect(pruneExpired).toHaveBeenCalledTimes(1);

    release(0);
    await first;

    // Subsequent sweeps use the normal resolved implementation again.
    pruneExpired.mockResolvedValue(0);
    await service.runCleanup();
    expect(pruneExpired).toHaveBeenCalledTimes(2);
  });

  it('schedules sweeps on the configured interval and stops on shutdown', async () => {
    vi.useFakeTimers();
    const runCleanup = vi
      .spyOn(service, 'runCleanup')
      .mockResolvedValue(undefined);

    // Default interval: 5 minutes.
    service.onModuleInit();
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(runCleanup).toHaveBeenCalledTimes(1);

    service.onApplicationShutdown();
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(runCleanup).toHaveBeenCalledTimes(1);
  });

  it('honours AUTH_CLEANUP_INTERVAL_MS', async () => {
    service = new TokenCleanupService(
      createConfigMock('1000', '30'),
      { pruneExpired } as unknown as RevocationService,
      { purgeExpired: purgeAuthTokens } as unknown as AuthTokenService,
      { purgeExpired: purgeRefreshTokens } as unknown as RefreshTokenService,
      { purgeExpired: purgeEmailChanges } as unknown as EmailChangeService,
      { purgeExpired: purgeAuditLogs } as unknown as AuditService,
    );
    vi.useFakeTimers();
    const runCleanup = vi
      .spyOn(service, 'runCleanup')
      .mockResolvedValue(undefined);

    service.onModuleInit();
    vi.advanceTimersByTime(1000);
    expect(runCleanup).toHaveBeenCalledTimes(1);
  });

  it('honours AUDIT_LOG_RETENTION_DAYS', async () => {
    service = new TokenCleanupService(
      createConfigMock(undefined, '30'),
      { pruneExpired } as unknown as RevocationService,
      { purgeExpired: purgeAuthTokens } as unknown as AuthTokenService,
      { purgeExpired: purgeRefreshTokens } as unknown as RefreshTokenService,
      { purgeExpired: purgeEmailChanges } as unknown as EmailChangeService,
      { purgeExpired: purgeAuditLogs } as unknown as AuditService,
    );

    await service.runCleanup();

    expect(purgeAuditLogs).toHaveBeenCalledWith(30);
  });
});
