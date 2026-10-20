import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipApiEnvelope } from '../common/http/skip-api-envelope.decorator.js';
import { MetricsTokenGuard } from './metrics-token.guard.js';
import { SystemProbeService } from './system-probe.service.js';

/**
 * Native JSON metrics endpoint (`/metrics`).
 *
 * No Prometheus dependency: the payload exposes process telemetry plus the
 * bounded Postgres/Redis checks from `SystemProbeService`. Protected by
 * `METRICS_TOKEN` only when that variable is configured.
 */
@ApiExcludeController()
@Controller('metrics')
@UseGuards(MetricsTokenGuard)
export class MetricsController {
  constructor(private readonly probe: SystemProbeService) {}

  /**
   * @returns Process and dependency telemetry.
   */
  @Get()
  @SkipApiEnvelope()
  async getMetrics() {
    const readiness = await this.probe.check();
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();

    return {
      timestamp: readiness.timestamp,
      uptimeSeconds: Math.round(process.uptime()),
      process: {
        pid: process.pid,
        node: process.version,
        memory: {
          rss: memory.rss,
          heapTotal: memory.heapTotal,
          heapUsed: memory.heapUsed,
          external: memory.external,
        },
        cpu: {
          userMicroseconds: cpu.user,
          systemMicroseconds: cpu.system,
        },
      },
      dependencies: readiness.checks,
      status: readiness.status,
    };
  }
}
