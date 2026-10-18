import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Minimal readiness check for the database wiring.
 *
 * Will be superseded by the `@nestjs/terminus` health module (database + Redis
 * indicators) once the cache layer lands — see AGENTS.md, "Infrastructure".
 */
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Pings the database with `SELECT 1`.
   *
   * @returns `200` with `{ status: 'ok', database: 'up', responseTimeMs }` when
   * the database responds, `503` otherwise.
   */
  @Get()
  async check(): Promise<{
    status: 'ok';
    database: 'up';
    responseTimeMs: number;
  }> {
    const startedAt = Date.now();

    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'down',
      });
    }

    return {
      status: 'ok',
      database: 'up',
      responseTimeMs: Date.now() - startedAt,
    };
  }
}
