import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Ip,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiStandardErrors } from '../../../common/http/api-standard-errors.decorator.js';
import { MessageResponseDto } from '../../../common/http/message-response.dto.js';
import { CurrentUser } from '../../decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard.js';
import { clearRefreshCookie } from '../../token/refresh-cookie.js';
import { requestMeta } from '../auth.types.js';
import { ApproveEmailChangeDto } from './dto/approve-email-change.dto.js';
import { ApproveEmailChangeQueryDto } from './dto/approve-email-change-query.dto.js';
import { ChangeEmailDto } from './dto/change-email.dto.js';
import {
  EmailChangePendingResponseDto,
  EmailChangePreviewResponseDto,
} from './dto/email-change-response.dto.js';
import type {
  EmailChangePreviewView,
  PendingEmailChangeView,
} from './email-change.service.js';
import { EmailChangeService } from './email-change.service.js';

/**
 * Two-sided email change (`/auth/email`).
 *
 * The approval link is public because it is the target of an email: the token
 * itself authorizes the swap. Starting or cancelling a change requires the
 * authenticated owner and their password.
 */
@ApiTags('Auth')
@ApiStandardErrors()
@Controller('auth')
export class EmailChangeController {
  constructor(private readonly emailChange: EmailChangeService) {}

  /**
   * `POST /auth/email` — starts the change. Verified accounts receive an
   * approval link at their current address (sessions stay valid); unverified
   * accounts change immediately, so their sessions are revoked and the refresh
   * cookie is cleared.
   */
  @Post('email')
  @HttpCode(200)
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Change the account email',
    description:
      'Verified accounts approve the change from their current address; unverified accounts switch immediately and receive a verification link at the new address. Every password-protected path revokes sessions once the address actually changes.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  async request(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangeEmailDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) response: Response,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{ message: string }> {
    const result = await this.emailChange.request(
      user.id,
      dto,
      requestMeta(ip, userAgent),
    );

    if (result.sessionsRevoked) {
      clearRefreshCookie(response);
    }

    return { message: result.message };
  }

  /**
   * `GET /auth/email` — the caller's pending change, or `null`.
   *
   * Lets a client show "waiting for approval from your current address"
   * without changing the shape of `/auth/me`.
   */
  @Get('email')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get the pending email change',
    description:
      'Returns the pending two-sided change, or `null` when none is active.',
  })
  @ApiOkResponse({ type: EmailChangePendingResponseDto })
  getPending(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PendingEmailChangeView | null> {
    return this.emailChange.getPending(user.id);
  }

  /**
   * `DELETE /auth/email` — cancels a pending change (idempotent).
   */
  @Delete('email')
  @HttpCode(200)
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Cancel a pending email change' })
  @ApiOkResponse({ type: MessageResponseDto })
  cancel(@CurrentUser() user: AuthenticatedUser): Promise<{ message: string }> {
    return this.emailChange.cancel(user.id);
  }

  /**
   * `GET /auth/email/approve` — non-mutating preview of the approval link.
   *
   * Opening an email link (including automated mail-scanner prefetches) must
   * not perform the swap; it only shows the address awaiting approval.
   */
  @Get('email/approve')
  @ApiOperation({
    summary: 'Preview an email-change approval link',
    description:
      'Validates the single-use token and returns the pending address without consuming the link or changing the account.',
  })
  @ApiOkResponse({ type: EmailChangePreviewResponseDto })
  preview(
    @Query() dto: ApproveEmailChangeQueryDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<EmailChangePreviewView> {
    return this.emailChange.preview(dto.token, requestMeta(ip, userAgent));
  }

  /**
   * `POST /auth/email/approve` — consumes the approval link, swaps the email,
   * revokes sessions and starts verification of the new address.
   */
  @Post('email/approve')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Approve an email change',
    description:
      'Consumes the single-use token from the approval email sent to the current address.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  approve(
    @Body() dto: ApproveEmailChangeDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{ message: string }> {
    return this.emailChange.approve(dto.token, requestMeta(ip, userAgent));
  }
}
