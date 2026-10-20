import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Ip,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiStandardErrors } from '../../../common/http/api-standard-errors.decorator.js';
import { MessageResponseDto } from '../../../common/http/message-response.dto.js';
import { requestMeta } from '../auth.types.js';
import { RegisterDto } from './dto/register.dto.js';
import { ResendVerificationDto } from './dto/resend-verification.dto.js';
import { VerifyEmailQueryDto } from './dto/verify-email-query.dto.js';
import { RegistrationService } from './registration.service.js';

/**
 * Registration journey (`/auth`): register, verify the email and re-send the
 * verification link. Keeps HTTP concerns (request metadata) in the controller.
 */
@ApiTags('Auth')
@ApiStandardErrors()
@Controller('auth')
export class RegistrationController {
  constructor(private readonly registration: RegistrationService) {}

  /**
   * `POST /auth/register` — creates an unverified account and sends the
   * verification email.
   */
  @Post('register')
  @ApiOperation({ summary: 'Register a new account' })
  @ApiCreatedResponse({ type: MessageResponseDto })
  register(
    @Body() dto: RegisterDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{ message: string }> {
    return this.registration.register(dto, requestMeta(ip, userAgent));
  }

  /**
   * `GET /auth/verify-email?token=...` — consumes the verification link.
   */
  @Get('verify-email')
  @ApiOperation({ summary: 'Verify an email address' })
  @ApiOkResponse({ type: MessageResponseDto })
  verifyEmail(
    @Query() query: VerifyEmailQueryDto,
  ): Promise<{ message: string }> {
    return this.registration.verifyEmail(query.token);
  }

  /**
   * `POST /auth/resend-verification` — re-sends the verification email.
   */
  @Post('resend-verification')
  @HttpCode(200)
  @ApiOperation({ summary: 'Re-send the verification email' })
  @ApiOkResponse({ type: MessageResponseDto })
  resendVerification(
    @Body() dto: ResendVerificationDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{ message: string }> {
    return this.registration.resendVerification(
      dto.identifier,
      requestMeta(ip, userAgent),
    );
  }
}
