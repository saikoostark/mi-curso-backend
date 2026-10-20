import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Swagger representation of one validation/problem detail. */
export class ApiErrorDetailDto {
  @ApiPropertyOptional({
    example: 'email',
    description: 'Dotted path of the offending field, when applicable.',
  })
  field?: string;

  @ApiProperty({ example: 'email must be a valid email address' })
  message: string;
}

/** Swagger representation of the error payload inside the envelope. */
export class ApiErrorDto {
  @ApiProperty({
    example: 'user_not_found',
    description: 'Stable machine-readable error code.',
  })
  code: string;

  @ApiProperty({
    example: 'User not found.',
    description: 'Human-readable error description.',
  })
  message: string;

  @ApiPropertyOptional({
    type: [ApiErrorDetailDto],
    description: 'Field-level validation or problem details.',
  })
  details?: ApiErrorDetailDto[];

  @ApiPropertyOptional({
    type: Object,
    description: 'Additional domain context (for example missing attributes).',
    example: { required: ['users:read'] },
  })
  meta?: Record<string, unknown>;
}

/** Common error envelope returned by every failing request. */
export class ApiErrorResponseDto {
  @ApiProperty({ example: false })
  success: false;

  @ApiProperty({ type: ApiErrorDto })
  error: ApiErrorDto;
}
