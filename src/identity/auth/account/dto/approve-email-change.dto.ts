import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Body of `POST /auth/email/approve`.
 *
 * The token travels in the body (not the URL) so the mutating request does not
 * leak the single-use secret into access logs or referrer headers.
 */
export class ApproveEmailChangeDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}
