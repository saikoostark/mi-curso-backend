import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Default 1-based page number. */
export const DEFAULT_PAGE = 1;

/** Default page size. */
export const DEFAULT_PAGE_LIMIT = 25;

/** Largest page size accepted by any paged endpoint. */
export const MAX_PAGE_LIMIT = 100;

/**
 * Shared query parameters for offset-paged list endpoints.
 *
 * Values arrive as query strings, so `@Type(() => Number)` converts them before
 * the integer validators run. Endpoints extend this class to inherit both the
 * validation and the Swagger metadata.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    default: DEFAULT_PAGE,
    description: '1-based page number.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = DEFAULT_PAGE;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_PAGE_LIMIT,
    default: DEFAULT_PAGE_LIMIT,
    description: 'Maximum number of rows per page.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit: number = DEFAULT_PAGE_LIMIT;
}

/**
 * Metadata that accompanies every paged `data` object.
 *
 * The item list itself is the sibling `page` property of the response data, as
 * required by the API envelope.
 */
export class PaginationMeta {
  @ApiProperty({ example: 1, description: 'Current 1-based page.' })
  page: number;

  @ApiProperty({ example: 25, description: 'Requested page size.' })
  limit: number;

  @ApiProperty({ example: 42, description: 'Total number of matching rows.' })
  total: number;

  @ApiProperty({ example: 2, description: 'Total number of pages.' })
  totalPages: number;

  @ApiProperty({ example: true })
  hasNext: boolean;

  @ApiProperty({ example: false })
  hasPrevious: boolean;
}

/**
 * Builds the pagination block for a page of rows.
 *
 * An empty result has `totalPages: 0`; `hasNext`/`hasPrevious` are derived from
 * the page number so clients do not need to duplicate the arithmetic.
 *
 * @param page - 1-based page number.
 * @param limit - Page size.
 * @param total - Total number of matching rows.
 * @returns The pagination metadata.
 */
export function buildPaginationMeta(
  page: number,
  limit: number,
  total: number,
): PaginationMeta {
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrevious: page > 1,
  };
}
