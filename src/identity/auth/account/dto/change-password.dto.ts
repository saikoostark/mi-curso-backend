import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../../../password/password-policy.js';

/**
 * Payload for `PATCH /auth/password` (change while logged in). The full policy
 * is additionally enforced in the service, where the user's email/username are
 * known.
 */
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword: string;

  @IsString()
  @MinLength(1)
  passwordConfirm: string;
}
