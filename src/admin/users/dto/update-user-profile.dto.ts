import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { trimOrNull } from '../../../identity/users/user.util.js';

/** Trims the value and turns a blank string into `null`. */
const trim = ({ value }: { value: unknown }): string | null | undefined =>
  trimOrNull(value);

/**
 * Profile-field part of `PATCH /users/:id`.
 *
 * Omitted fields stay untouched; all three may be sent as `null` (or blank) to
 * clear them (`user_profiles` columns are nullable).
 */
export class UpdateUserProfileDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string | null;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string | null;

  @Transform(trim)
  @IsOptional()
  @Matches(/^\+?[1-9]\d{6,14}$/, {
    message: 'phone must be a valid phone number (E.164-like)',
  })
  phone?: string | null;
}
