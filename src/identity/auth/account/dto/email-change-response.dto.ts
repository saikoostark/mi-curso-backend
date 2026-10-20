import { ApiProperty } from '@nestjs/swagger';

/** Pending two-sided email change of the authenticated account. */
export class PendingEmailChangeDto {
  @ApiProperty({ example: 'new@example.com' })
  newEmail: string;

  @ApiProperty({
    format: 'date-time',
    description: 'When the change was requested.',
  })
  createdAt: string;

  @ApiProperty({
    format: 'date-time',
    description: 'When the approval link stops working.',
  })
  expiresAt: string;
}

/**
 * Body of `GET /auth/email`.
 *
 * `null` means there is no usable pending change (none was requested, it was
 * cancelled, or it expired).
 */
export class EmailChangePendingResponseDto {
  @ApiProperty({ example: true })
  success: true;

  @ApiProperty({ type: PendingEmailChangeDto, nullable: true })
  data: PendingEmailChangeDto | null;
}

/** Non-mutating preview of an approval link. */
export class EmailChangePreviewDataDto {
  @ApiProperty({ example: 'new@example.com' })
  newEmail: string;

  @ApiProperty({
    format: 'date-time',
    description: 'When the approval link stops working.',
  })
  expiresAt: string;
}

/** Body of `GET /auth/email/approve` (preview; approval is a POST). */
export class EmailChangePreviewResponseDto {
  @ApiProperty({ example: true })
  success: true;

  @ApiProperty({ type: EmailChangePreviewDataDto })
  data: EmailChangePreviewDataDto;
}
