import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
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
import { UserResponseDto } from '../../users/dto/user-response.dto.js';
import type { UserView } from '../../users/user.view.js';
import { AccountService } from './account.service.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { DeleteAccountDto } from './dto/delete-account.dto.js';
import { UpdateOwnProfileDto } from './dto/update-own-profile.dto.js';

/**
 * Account journey (`/auth`): the authenticated caller's own profile and
 * password. Both routes are guarded by `JwtAuthGuard`.
 */
@ApiTags('Auth')
@ApiBearerAuth('access-token')
@ApiStandardErrors()
@Controller('auth')
@UseGuards(JwtAuthGuard)
export class AccountController {
  constructor(private readonly account: AccountService) {}

  /**
   * `GET /auth/me` — the authenticated user's account with its profile.
   */
  @Get('me')
  @ApiOperation({ summary: 'Read the authenticated user' })
  @ApiOkResponse({ type: UserResponseDto })
  me(@CurrentUser() user: AuthenticatedUser): Promise<UserView> {
    return this.account.me(user.id);
  }

  /**
   * `PATCH /auth/me` — edits the authenticated user's own profile (display
   * fields only).
   */
  @Patch('me')
  @ApiOperation({
    summary: 'Update the authenticated user profile',
    description: 'Display fields only; omitted keys stay untouched.',
  })
  @ApiOkResponse({ type: UserResponseDto })
  updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateOwnProfileDto,
  ): Promise<UserView> {
    return this.account.updateProfile(user.id, dto);
  }

  /**
   * `PATCH /auth/password` — changes the password; every session (including
   * this one) is revoked and the refresh cookie is cleared.
   */
  @Patch('password')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Change the password',
    description: 'Revokes every session and forces a fresh login.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ message: string }> {
    const result = await this.account.changePassword(user.id, dto);
    clearRefreshCookie(response);
    return result;
  }

  /**
   * `POST /auth/delete-account` — soft-deletes the own account; the password
   * must be re-entered. An admin can restore the account later.
   */
  @Post('delete-account')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Delete the own account',
    description:
      'Soft-deletes the account (restorable by an admin) and clears the refresh cookie.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  async deleteAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DeleteAccountDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ message: string }> {
    const result = await this.account.deleteAccount(user.id, dto);
    clearRefreshCookie(response);
    return result;
  }
}
