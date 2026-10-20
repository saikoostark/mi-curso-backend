import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Query parameters for `GET /auth/email/approve` (the link target in the
 * approval email sent to the account's current address).
 */
export class ApproveEmailChangeQueryDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}
