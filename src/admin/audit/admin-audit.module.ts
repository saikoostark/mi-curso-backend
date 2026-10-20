import { Module } from '@nestjs/common';
import { IdentityModule } from '../../identity/identity.module.js';
import { RateLimitModule } from '../../rate-limit/rate-limit.module.js';
import { AdminAuditController } from './admin-audit.controller.js';
import { CanReadAuditLogs } from './audit.guards.js';

/**
 * Read-only audit administration (`/audit-logs`).
 *
 * `AuditModule` is global, so the controller injects `AuditService` directly;
 * `IdentityModule` supplies the JWT guard and the authorization engine used by
 * `CanReadAuditLogs`.
 */
@Module({
  imports: [IdentityModule, RateLimitModule],
  controllers: [AdminAuditController],
  providers: [CanReadAuditLogs],
})
export class AdminAuditModule {}
