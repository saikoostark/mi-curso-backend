import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/http/pagination.js';

/** Trims a filter and drops a blank one. */
const normalizeText = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/** Converts the `"true"`/`"false"` query strings into booleans. */
const parseBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return value;
};

/** Converts an ISO date string into a `Date` before validation. */
const parseDate = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? new Date(value) : value;

/**
 * Query parameters for `GET /audit-logs`.
 *
 * Filters are combinable. `action` is a case-insensitive partial match on the
 * route pattern (`POST /users/:id/restore`); the remaining filters are exact.
 * `from`/`to` bound `createdAt` inclusively.
 */
export class ListAuditLogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Case-insensitive partial match on the action.',
    maxLength: 200,
    example: 'users',
  })
  @Transform(normalizeText)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  action?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Only entries performed by this account.',
  })
  @IsOptional()
  @IsUUID()
  actorUserId?: string;

  @ApiPropertyOptional({
    description: 'Exact target type (first path segment).',
    maxLength: 64,
    example: 'users',
  })
  @Transform(normalizeText)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  targetType?: string;

  @ApiPropertyOptional({
    description: 'Exact target id, user id or attribute key.',
    maxLength: 128,
  })
  @Transform(normalizeText)
  @IsOptional()
  @IsString()
  @MaxLength(128)
  targetId?: string;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Filter by outcome (`true` only successful mutations).',
  })
  @Transform(parseBoolean)
  @IsOptional()
  @IsBoolean()
  success?: boolean;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Inclusive lower bound on the entry timestamp.',
  })
  @Transform(parseDate)
  @IsOptional()
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Inclusive upper bound on the entry timestamp.',
  })
  @Transform(parseDate)
  @IsOptional()
  @IsDate()
  to?: Date;
}
