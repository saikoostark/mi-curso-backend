import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/http/pagination.js';
import type {
  AdminUserSortField,
  AdminUserStatus,
  SortOrder,
} from '../admin-users-read.service.js';

/** Trims the search term and drops a blank one. */
const normalizeSearch = ({ value }: { value: unknown }): unknown => {
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

/** Lowercases the sort direction. */
const normalizeOrder = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.toLowerCase() : value;

/**
 * Query parameters for `GET /users`: 1-based paging plus optional filters.
 *
 * Filters are combinable; `search` is a case-insensitive partial match on
 * email, username and profile names. Sorting is restricted to a whitelist
 * (`createdAt`, `email`, `username`) so the column name never comes from the
 * request, and the id tie-breaker keeps offset paging stable.
 */
export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ['active', 'deleted', 'all'],
    default: 'active',
    description:
      'Account state to include: active accounts only, soft-deleted only, or both.',
  })
  @IsOptional()
  @IsIn(['active', 'deleted', 'all'])
  status?: AdminUserStatus;

  @ApiPropertyOptional({
    description:
      'Case-insensitive partial match on email, username, first or last name.',
    maxLength: 100,
  })
  @Transform(normalizeSearch)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Filter by whether the email is verified.',
  })
  @Transform(parseBoolean)
  @IsOptional()
  @IsBoolean()
  emailVerified?: boolean;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Filter by the superuser flag.',
  })
  @Transform(parseBoolean)
  @IsOptional()
  @IsBoolean()
  isSuperuser?: boolean;

  @ApiPropertyOptional({
    enum: ['createdAt', 'email', 'username'],
    default: 'createdAt',
    description: 'Sort column (whitelisted).',
  })
  @IsOptional()
  @IsIn(['createdAt', 'email', 'username'])
  sort?: AdminUserSortField;

  @ApiPropertyOptional({
    enum: ['asc', 'desc'],
    default: 'desc',
    description: 'Sort direction.',
  })
  @Transform(normalizeOrder)
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: SortOrder;
}
