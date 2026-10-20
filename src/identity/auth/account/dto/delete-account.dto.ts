import { Equals, IsNotEmpty, IsString } from 'class-validator';

/**
 * Payload for `POST /auth/delete-account` (self-service account deletion).
 *
 * The password re-authenticates the caller and `confirm` must be literally
 * `true`, so an accidental or CSRF-triggered request cannot delete an account.
 */
export class DeleteAccountDto {
  @IsString()
  @IsNotEmpty()
  password: string;

  @Equals(true, { message: 'confirm must be true' })
  confirm: boolean;
}
