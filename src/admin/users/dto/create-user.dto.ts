import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../../../identity/password/password-policy.js';
import {
  normalizeIdentity,
  trimOrNull,
} from '../../../identity/users/user.util.js';

/** Trims and lowercases string identifiers before validation. */
const normalize = ({ value }: { value: unknown }): string =>
  normalizeIdentity(typeof value === 'string' ? value : '');

/** Trims the value and turns a blank string into `null`. */
const trim = ({ value }: { value: unknown }): string | null | undefined =>
  trimOrNull(value);

/**
 * Payload for `POST /users` (admin creation).
 *
 * The account is created **verified** — an admin vouches for it, so no
 * verification email is sent.
 */
export class CreateUserDto {
  @Transform(normalize)
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  email: string;

  @Transform(normalize)
  @Matches(/^[a-z0-9_.-]{3,30}$/, {
    message:
      'username must be 3-30 characters long and use only a-z, 0-9, "_", "-" or "."',
  })
  username: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;

  @IsString()
  @MinLength(1)
  passwordConfirm: string;

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

  @IsOptional()
  @Matches(/^\+?[1-9]\d{6,14}$/, {
    message: 'phone must be a valid phone number (E.164-like)',
  })
  phone?: string;
}
