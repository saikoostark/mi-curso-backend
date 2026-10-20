import { ApiProperty } from '@nestjs/swagger';

/**
 * One active session of the authenticated user.
 *
 * `id` is the refresh-token ledger row id and is what
 * `DELETE /auth/sessions/:id` revokes. `current` marks the session the request
 * itself is made with.
 */
export class SessionView {
  @ApiProperty({
    format: 'uuid',
    description: 'Session id used to revoke it.',
  })
  id: string;

  @ApiProperty({
    nullable: true,
    example: '203.0.113.7',
    description: 'Client IP recorded at login/rotation.',
  })
  ip: string | null;

  @ApiProperty({
    nullable: true,
    example: 'Mozilla/5.0',
    description: 'User agent recorded at login/rotation.',
  })
  userAgent: string | null;

  @ApiProperty({
    format: 'date-time',
    description: 'When the session (last rotation) was created.',
  })
  createdAt: Date;

  @ApiProperty({
    format: 'date-time',
    description: 'Last time this session was used (login or rotation).',
  })
  lastUsedAt: Date;

  @ApiProperty({
    format: 'date-time',
    description: 'When the session stops being valid.',
  })
  expiresAt: Date;

  @ApiProperty({ description: 'True for the session making the request.' })
  current: boolean;
}

/** Body of `GET /auth/sessions`. */
export class SessionListDataDto {
  @ApiProperty({ type: [SessionView] })
  sessions: SessionView[];
}

/** Success envelope for the session list. */
export class SessionListResponseDto {
  @ApiProperty({ example: true })
  success: true;

  @ApiProperty({ type: SessionListDataDto })
  data: SessionListDataDto;
}
