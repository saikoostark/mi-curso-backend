import { Transform } from 'class-transformer';
import { IsEmail, Matches, MaxLength, ValidateIf } from 'class-validator';
import { normalizeIdentity } from '../../../identity/users/user.util.js';

/** Trims and lowercases string identifiers before validation. */
const normalize = ({ value }: { value: unknown }): string =>
  normalizeIdentity(typeof value === 'string' ? value : '');

/**
 * Account-field part of `PATCH /users/:id`.
 *
 * Email and username are identity columns of `users`; neither can be cleared.
 * `ValidateIf` (not `IsOptional`) is deliberate: omitted fields are skipped,
 * but an explicit `null` is validated and rejected instead of reaching a
 * not-null column.
 */
export class UpdateAccountDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(normalize)
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  email?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(normalize)
  @Matches(/^[a-z0-9_.-]{3,30}$/, {
    message:
      'username must be 3-30 characters long and use only a-z, 0-9, "_", "-" or "."',
  })
  username?: string;
}
