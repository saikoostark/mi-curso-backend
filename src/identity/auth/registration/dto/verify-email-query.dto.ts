import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Query parameters for `GET /auth/verify-email`.
 */
export class VerifyEmailQueryDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}
