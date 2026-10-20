import { ApiProperty } from '@nestjs/swagger';
import type { AuditLog } from './audit-log.entity.js';

/** API representation of one audit row. */
export class AuditLogView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'Authenticated actor, or null for an anonymous flow.',
  })
  actorUserId: string | null;

  @ApiProperty({ example: 'POST /users/:id/restore' })
  action: string;

  @ApiProperty({ nullable: true, example: 'users' })
  targetType: string | null;

  @ApiProperty({ nullable: true, example: 'f1f0…' })
  targetId: string | null;

  @ApiProperty({ nullable: true, example: '203.0.113.7' })
  ip: string | null;

  @ApiProperty({ nullable: true, example: 'Mozilla/5.0' })
  userAgent: string | null;

  @ApiProperty({ example: 200 })
  statusCode: number;

  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

/**
 * Maps an entity row to the API shape.
 *
 * @param log - Persisted audit row.
 * @returns The view with an ISO timestamp.
 */
export function toAuditLogView(log: AuditLog): AuditLogView {
  return {
    id: log.id,
    actorUserId: log.actorUserId,
    action: log.action,
    targetType: log.targetType,
    targetId: log.targetId,
    ip: log.ip,
    userAgent: log.userAgent,
    statusCode: log.statusCode,
    success: log.success,
    createdAt: log.createdAt.toISOString(),
  };
}
