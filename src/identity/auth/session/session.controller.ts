import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiStandardErrors } from '../../../common/http/api-standard-errors.decorator.js';
import { MessageResponseDto } from '../../../common/http/message-response.dto.js';
import { CurrentUser } from '../../decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard.js';
import { OptionalJwtAuthGuard } from '../../guards/optional-jwt-auth.guard.js';
import {
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
} from '../../token/refresh-cookie.js';
import { TOKEN_ERRORS } from '../../token/token.error-codes.js';
import type { UserView } from '../../users/user.view.js';
import { requestMeta } from '../auth.types.js';
import { LoginDto } from './dto/login.dto.js';
import {
  SessionListResponseDto,
  SessionView,
} from './dto/session-list-response.dto.js';
import { SessionResponseDto } from './dto/session-response.dto.js';
import { SessionService } from './session.service.js';

/**
 * Session journey (`/auth`): login, refresh rotation, session listing and
 * logout (current device, other devices, or everywhere).
 *
 * The refresh token travels only in its httpOnly cookie; the access token is
 * returned in the body.
 */
@ApiTags('Auth')
@ApiStandardErrors()
@Controller('auth')
export class SessionController {
  constructor(private readonly sessions: SessionService) {}

  /**
   * `POST /auth/login` — email/username + password; returns the access token
   * in the body and the refresh token in its httpOnly cookie.
   */
  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Log in',
    description:
      'Returns the access token in the envelope and sets the refresh cookie.',
  })
  @ApiOkResponse({ type: SessionResponseDto })
  async login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) response: Response,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{ accessToken: string; user: UserView }> {
    const result = await this.sessions.login(
      dto.identifier,
      dto.password,
      requestMeta(ip, userAgent),
    );

    setRefreshCookie(response, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  /**
   * `POST /auth/refresh` — rotates the refresh cookie and returns a new
   * access token.
   */
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate the refresh token' })
  @ApiCookieAuth('refresh-cookie')
  @ApiOkResponse({ type: SessionResponseDto })
  async refresh(
    @Req() request: Request,
    @Ip() ip: string,
    @Res({ passthrough: true }) response: Response,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{ accessToken: string; user: UserView }> {
    const rawToken = readRefreshCookie(request);
    if (!rawToken) {
      throw new UnauthorizedException({
        code: TOKEN_ERRORS.invalidRefreshToken,
        message: 'Invalid or expired refresh token.',
      });
    }

    const result = await this.sessions.refresh(
      rawToken,
      requestMeta(ip, userAgent),
    );

    setRefreshCookie(response, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  /**
   * `POST /auth/logout` — logs out of every device (all refresh tokens
   * revoked, all access tokens invalidated via the watermark).
   */
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Log out everywhere' })
  @ApiBearerAuth('access-token')
  @ApiOkResponse({ type: MessageResponseDto })
  @UseGuards(JwtAuthGuard)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ message: string }> {
    clearRefreshCookie(response);
    return this.sessions.logout(user.id);
  }

  /**
   * `GET /auth/sessions` — lists the caller's active sessions, marking the one
   * making the request.
   */
  @Get('sessions')
  @ApiOperation({ summary: 'List active sessions' })
  @ApiBearerAuth('access-token')
  @ApiOkResponse({ type: SessionListResponseDto })
  @UseGuards(JwtAuthGuard)
  listSessions(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ sessions: SessionView[] }> {
    return this.sessions.listSessions(user);
  }

  /**
   * `DELETE /auth/sessions/:id` — revokes one session. Revoking the caller's
   * own session also clears the refresh cookie (the client logs in again on
   * that device only).
   */
  @Delete('sessions/:id')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Revoke one session',
    description:
      'Revoking the current session also clears the refresh cookie; other devices stay logged in.',
  })
  @ApiBearerAuth('access-token')
  @ApiOkResponse({ type: MessageResponseDto })
  @UseGuards(JwtAuthGuard)
  async revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ message: string }> {
    const result = await this.sessions.revokeSession(user, id);
    if (result.current) {
      clearRefreshCookie(response);
    }

    return { message: result.message };
  }

  /**
   * `POST /auth/logout/current` — logs out this device only; other sessions
   * keep working. Accepts a valid access token or the refresh cookie.
   */
  @Post('logout/current')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Log out of this device',
    description:
      'Accepts a valid access token or the refresh cookie; other devices stay logged in.',
  })
  @ApiBearerAuth('access-token')
  @ApiCookieAuth('refresh-cookie')
  @ApiOkResponse({ type: MessageResponseDto })
  @UseGuards(OptionalJwtAuthGuard)
  async logoutCurrent(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ message: string }> {
    const user =
      (request as Request & { user?: AuthenticatedUser }).user ?? null;
    const rawToken = readRefreshCookie(request);
    const result = await this.sessions.logoutCurrent(user, rawToken);
    clearRefreshCookie(response);
    return result;
  }

  /**
   * `POST /auth/logout/others` — logs out every other device; the calling
   * session keeps working.
   */
  @Post('logout/others')
  @HttpCode(200)
  @ApiOperation({ summary: 'Log out of other devices' })
  @ApiBearerAuth('access-token')
  @ApiOkResponse({ type: MessageResponseDto })
  @UseGuards(JwtAuthGuard)
  logoutOthers(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ message: string }> {
    return this.sessions.logoutOthers(user);
  }
}
