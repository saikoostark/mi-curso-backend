import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';

/**
 * Exposes the application health endpoint.
 *
 * The `DataSource` dependency is injectable here because `DatabaseModule`
 * registers it application-wide.
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
