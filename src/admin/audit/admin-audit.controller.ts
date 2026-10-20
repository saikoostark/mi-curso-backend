import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { PaginatedData } from '../../common/http/api-response.js';
import { paginated } from '../../common/http/api-response.js';
import { ApiStandardErrors } from '../../common/http/api-standard-errors.decorator.js';
import { buildPaginationMeta } from '../../common/http/pagination.js';
import { RateLimiter } from '../../rate-limit/rate-limiter.js';
import type { AuditLogView } from '../../audit/audit-log.view.js';
import { AuditService } from '../../audit/audit.service.js';
import { CurrentUser } from '../../identity/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../identity/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../identity/guards/jwt-auth.guard.js';
import { CanReadAuditLogs } from './audit.guards.js';
import { AuditLogListResponseDto } from './dto/audit-log-response.dto.js';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto.js';

/**
 * Read-only access to the security audit trail (`/audit-logs`).
 *
 * Only `audit:read` holders (or superusers) can inspect it. Rows are written by
 * the global `AuditInterceptor`; there is no write or delete endpoint, and the
 * retention sweep owns expiry.
 */
@ApiTags('Audit')
@ApiBearerAuth('access-token')
@ApiStandardErrors()
@Controller('audit-logs')
@UseGuards(JwtAuthGuard)
export class AdminAuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly rateLimiter: RateLimiter,
  ) {}

  /**
   * `GET /audit-logs` — one newest-first page with optional filters.
   *
   * Reads are capped per actor so a compromised or scripted admin token cannot
   * hammer the audit indexes indefinitely.
   */
  @Get()
  @ApiOperation({ summary: 'List audit log entries' })
  @ApiOkResponse({ type: AuditLogListResponseDto })
  @UseGuards(CanReadAuditLogs)
  async list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListAuditLogsQueryDto,
  ): Promise<PaginatedData<AuditLogView>> {
    await this.rateLimiter.consume(`audit:rl:list:${actor.id}`, {
      limit: 60,
      windowSeconds: 60,
    });

    const result = await this.audit.list({
      offset: (query.page - 1) * query.limit,
      limit: query.limit,
      action: query.action,
      actorUserId: query.actorUserId,
      targetType: query.targetType,
      targetId: query.targetId,
      success: query.success,
      from: query.from,
      to: query.to,
    });

    return paginated(
      result.items,
      buildPaginationMeta(query.page, query.limit, result.total),
    );
  }
}
