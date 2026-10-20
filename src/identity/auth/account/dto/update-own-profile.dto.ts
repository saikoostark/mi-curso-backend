import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { trimOrNull } from '../../../users/user.util.js';

/** Trims the value and turns a blank string into `null`. */
const trim = ({ value }: { value: unknown }): string | null | undefined =>
  trimOrNull(value);

/**
 * Payload for `PATCH /auth/me` (self-service profile edit).
 *
 * Omitted fields stay untouched; sending `null` (or a blank string) clears a
 * field — all three columns are nullable. Account identifiers (email,
 * username) are deliberately not editable here: an email change has its own
 * verification flow.
 */
export class UpdateOwnProfileDto {
  @ApiPropertyOptional({ nullable: true, example: 'Jane' })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Doe' })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '+4915112345678' })
  @Transform(trim)
  @IsOptional()
  @Matches(/^\+?[1-9]\d{6,14}$/, {
    message: 'phone must be a valid phone number (E.164-like)',
  })
  phone?: string | null;
}
