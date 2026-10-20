import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';
import { normalizeIdentity } from '../../../users/user.util.js';

/** Trims and lowercases the identifier before validation. */
const normalize = ({ value }: { value: unknown }): string =>
  normalizeIdentity(typeof value === 'string' ? value : '');

/**
 * Payload for `POST /auth/login`. The identifier is a single field accepting
 * either the email address or the username.
 */
export class LoginDto {
  @Transform(normalize)
  @IsString()
  @IsNotEmpty()
  identifier: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}
