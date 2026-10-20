import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

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

/** Query parameters for `GET /users/:id`. */
export class GetUserQueryDto {
  @ApiPropertyOptional({
    type: Boolean,
    default: false,
    description:
      'Include the account even when it is soft-deleted (returns `deletedAt`).',
  })
  @Transform(parseBoolean)
  @IsOptional()
  @IsBoolean()
  withDeleted?: boolean;
}
