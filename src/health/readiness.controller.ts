import { Controller, Get, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { SkipApiEnvelope } from '../common/http/skip-api-envelope.decorator.js';
import { SystemProbeService } from './system-probe.service.js';

/**
 * Readiness endpoint (`/ready`).
 *
 * Unlike `/health`, this checks that Postgres answers `SELECT 1` and Redis
 * answers `PING`, with a short timeout per dependency. It returns `503` when
 * either is down so orchestrators stop routing traffic while leaving the
 * process itself alive. Raw body: probes are infrastructure data, not an API
 * resource.
 */
@ApiExcludeController()
@Controller('ready')
export class ReadinessController {
  constructor(private readonly probe: SystemProbeService) {}

  /**
   * @param response - Express response, only to set the 503 status.
   * @returns The readiness report.
   */
  @Get()
  @SkipApiEnvelope()
  async check(@Res({ passthrough: true }) response: Response) {
    const report = await this.probe.check();
    if (report.status === 'not_ready') {
      response.status(503);
    }
    return report;
  }
}
