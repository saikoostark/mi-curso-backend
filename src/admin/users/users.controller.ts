import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { PaginatedData } from '../../common/http/api-response.js';
import { paginated } from '../../common/http/api-response.js';
import { ApiStandardErrors } from '../../common/http/api-standard-errors.decorator.js';
import { MessageResponseDto } from '../../common/http/message-response.dto.js';
import { buildPaginationMeta } from '../../common/http/pagination.js';
import { CurrentUser } from '../../identity/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../identity/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../identity/guards/jwt-auth.guard.js';
import { PASSWORD_ERRORS } from '../../identity/password/password.error-codes.js';
import {
  UserListResponseDto,
  UserResponseDto,
} from '../../identity/users/dto/user-response.dto.js';
import type { UserView } from '../../identity/users/user.view.js';
import { AdminUsersService } from './admin-users.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { GetUserQueryDto } from './dto/get-user-query.dto.js';
import { ListUsersQueryDto } from './dto/list-users-query.dto.js';
import { RestoreUserDto } from './dto/restore-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import {
  CanAssignUserAttributes,
  CanCreateUsers,
  CanDeleteUsers,
  CanReadUsers,
  CanUpdateUsers,
} from './users.guards.js';
import { ADMIN_USER_ERRORS } from './users.error-codes.js';

/**
 * Admin user management (`/users`).
 *
 * `JwtAuthGuard` authenticates the caller; every route additionally declares
 * its capability as a named guard (`CanReadUsers`, `CanUpdateUsers`, ...) —
 * eligibility is decided from the request alone, superusers pass everything.
 * Actions on a superuser account are a state rule (the target's flag), so they
 * are enforced by `SuperuserProtectionPolicy` inside `AdminUsersService`, right
 * after the target is loaded, never as decoration. The superuser flag itself
 * is never writable through the API — it is bootstrapped with the CLI.
 */
@ApiTags('Users')
@ApiBearerAuth('access-token')
@ApiStandardErrors()
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users: AdminUsersService) {}

  /**
   * `GET /users?page=&limit=` — paged list with optional filters, newest first
   * by default. Active accounts only unless `status` asks for deleted ones.
   */
  @Get()
  @ApiOperation({
    summary: 'List users',
    description:
      'Offset-paged with optional account-state/search/verification/superuser filters and whitelisted sorting; the id tie-breaker keeps paging stable.',
  })
  @ApiOkResponse({ type: UserListResponseDto })
  @UseGuards(CanReadUsers)
  async list(
    @Query() query: ListUsersQueryDto,
  ): Promise<PaginatedData<UserView>> {
    const { items, total } = await this.users.list({
      offset: (query.page - 1) * query.limit,
      limit: query.limit,
      status: query.status,
      search: query.search,
      emailVerified: query.emailVerified,
      isSuperuser: query.isSuperuser,
      sort: query.sort,
      order: query.order,
    });

    return paginated(
      items,
      buildPaginationMeta(query.page, query.limit, total),
    );
  }

  /**
   * `POST /users` — creates a verified account (no email flow).
   */
  @Post()
  @ApiOperation({ summary: 'Create a verified user' })
  @ApiCreatedResponse({ type: UserResponseDto })
  @UseGuards(CanCreateUsers)
  create(@Body() dto: CreateUserDto): Promise<UserView> {
    if (dto.password !== dto.passwordConfirm) {
      throw new BadRequestException({
        code: PASSWORD_ERRORS.passwordMismatch,
        message: 'Password confirmation does not match.',
      });
    }

    return this.users.createVerified({
      email: dto.email,
      username: dto.username,
      password: dto.password,
      firstName: dto.firstName ?? null,
      lastName: dto.lastName ?? null,
      phone: dto.phone ?? null,
    });
  }

  /**
   * `GET /users/:id?withDeleted=true` — one user's account with its profile
   * flattened in. Deleted accounts are hidden unless explicitly requested.
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Get one user',
    description:
      'Soft-deleted accounts return 404 unless `withDeleted=true` is passed.',
  })
  @ApiOkResponse({ type: UserResponseDto })
  @UseGuards(CanReadUsers)
  get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: GetUserQueryDto,
  ): Promise<UserView> {
    return this.users.detail(id, query.withDeleted ?? false);
  }

  /**
   * `PATCH /users/:id` — updates account fields and/or profile fields; the
   * controller splits the payload and each half goes to its own service.
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Update a user account and/or profile' })
  @ApiOkResponse({ type: UserResponseDto })
  @UseGuards(CanUpdateUsers)
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserView> {
    return this.users.updateProfile(
      actor,
      id,
      { email: dto.email, username: dto.username },
      { firstName: dto.firstName, lastName: dto.lastName, phone: dto.phone },
    );
  }

  /**
   * `POST /users/:id/restore` — restores a soft-deleted account, optionally
   * with replacement identifiers when the stored ones were reused.
   */
  @Post(':id/restore')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Restore a soft-deleted user',
    description:
      'Restores the account; identifiers claimed by another account must be replaced.',
  })
  @ApiOkResponse({ type: UserResponseDto })
  @UseGuards(CanUpdateUsers)
  restore(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RestoreUserDto,
  ): Promise<UserView> {
    return this.users.restore(actor, id, dto);
  }

  /**
   * `DELETE /users/:id` — soft-deletes a user; sessions and pending tokens are
   * destroyed, while grants and memberships survive for a later restore.
   * Deleting yourself through the admin API is blocked.
   */
  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Soft-delete a user' })
  @ApiOkResponse({ type: MessageResponseDto })
  @UseGuards(CanDeleteUsers)
  async remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ message: string }> {
    if (actor.id === id) {
      throw new BadRequestException({
        code: ADMIN_USER_ERRORS.cannotDeleteSelf,
        message: 'You cannot delete your own account through the admin API.',
      });
    }

    await this.users.remove(actor, id);
    return { message: 'User deleted.' };
  }

  /**
   * `PUT /users/:id/attributes/:key` — grants an attribute directly
   * (idempotent; subset rule applies).
   */
  @Put(':id/attributes/:key')
  @HttpCode(200)
  @ApiOperation({ summary: 'Grant an attribute directly to a user' })
  @ApiOkResponse({ type: MessageResponseDto })
  @UseGuards(CanAssignUserAttributes)
  async grantAttribute(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('key') key: string,
  ): Promise<{ message: string }> {
    await this.users.grantAttribute(actor, id, key);

    return { message: `Attribute "${key}" granted.` };
  }

  /**
   * `DELETE /users/:id/attributes/:key` — revokes a direct grant
   * (idempotent).
   */
  @Delete(':id/attributes/:key')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke an attribute directly from a user' })
  @ApiOkResponse({ type: MessageResponseDto })
  @UseGuards(CanAssignUserAttributes)
  async revokeAttribute(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('key') key: string,
  ): Promise<{ message: string }> {
    await this.users.revokeAttribute(actor, id, key);

    return { message: `Attribute "${key}" revoked.` };
  }
}
