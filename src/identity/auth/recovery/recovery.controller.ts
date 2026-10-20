import { Body, Controller, Headers, HttpCode, Ip, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiStandardErrors } from '../../../common/http/api-standard-errors.decorator.js';
import { MessageResponseDto } from '../../../common/http/message-response.dto.js';
import { requestMeta } from '../auth.types.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { RecoveryService } from './recovery.service.js';

/**
 * Recovery journey (`/auth`): forgot-password and reset-password.
 */
@ApiTags('Auth')
@ApiStandardErrors()
@Controller('auth')
export class RecoveryController {
  constructor(private readonly recovery: RecoveryService) {}

  /**
   * `POST /auth/forgot-password` — starts the reset flow (always generic).
   */
  @Post('forgot-password')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Start the password reset flow',
    description: 'Always answers generically to avoid account enumeration.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{ message: string }> {
    return this.recovery.forgotPassword(
      dto.identifier,
      requestMeta(ip, userAgent),
    );
  }

  /**
   * `POST /auth/reset-password` — completes the reset flow with the token
   * from the emailed link.
   */
  @Post('reset-password')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Complete the password reset flow',
    description: 'Revokes every session after the password changes.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  resetPassword(@Body() dto: ResetPasswordDto): Promise<{ message: string }> {
    return this.recovery.resetPassword(
      dto.token,
      dto.newPassword,
      dto.passwordConfirm,
    );
  }
}
