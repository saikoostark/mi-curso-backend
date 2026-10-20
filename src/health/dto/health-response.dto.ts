import { ApiProperty } from '@nestjs/swagger';

/**
 * Raw liveness body.
 *
 * The health endpoint is intentionally outside the common API envelope so
 * infrastructure probes can keep parsing `{ status: 'ok' }` directly.
 */
export class HealthResponseDto {
  @ApiProperty({ example: 'ok' })
  status: 'ok';
}
