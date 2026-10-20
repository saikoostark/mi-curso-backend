import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { normalizeIdentity } from '../../../users/user.util.js';

/** Trims and lowercases the address before validation. */
const normalize = ({ value }: { value: unknown }): string =>
  normalizeIdentity(typeof value === 'string' ? value : '');

/**
 * Payload for `POST /auth/email`.
 *
 * The password proves the request comes from the account owner and not merely
 * from someone holding a stolen access token.
 */
export class ChangeEmailDto {
  @Transform(normalize)
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}
