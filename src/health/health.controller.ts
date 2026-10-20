import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipApiEnvelope } from '../common/http/skip-api-envelope.decorator.js';
import { HealthResponseDto } from './dto/health-response.dto.js';

/**
 * Liveness endpoint (`/health`).
 *
 * Answers `200` with `{ status: 'ok' }` whenever the process can serve
 * requests. It deliberately pings no dependencies: Postgres and Redis carry
 * their own health (infrastructure side), the application proves connectivity
 * at boot (Redis connects on module init) and schema state is owned by
 * migrations — so a dependency outage does not mark a running process dead.
 *
 * The raw body is kept outside the common API envelope: probes read it as
 * infrastructure data, not as an application resource.
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  /**
   * @returns The liveness report.
   */
  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({ type: HealthResponseDto })
  @SkipApiEnvelope()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
