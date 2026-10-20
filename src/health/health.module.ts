import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { MetricsController } from './metrics.controller.js';
import { MetricsTokenGuard } from './metrics-token.guard.js';
import { ReadinessController } from './readiness.controller.js';
import { SystemProbeService } from './system-probe.service.js';

/**
 * Probe endpoints.
 *
 * - `GET /health`: liveness only, no dependencies.
 * - `GET /ready`: Postgres + Redis reachability, `503` when either is down.
 * - `GET /metrics`: native JSON process/dependency telemetry, optionally
 *   protected by `METRICS_TOKEN`.
 *
 * `DataSource` and `CacheService` come from globally available providers.
 */
@Module({
  controllers: [HealthController, ReadinessController, MetricsController],
  providers: [SystemProbeService, MetricsTokenGuard],
})
export class HealthModule {}
