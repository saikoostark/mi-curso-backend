import {
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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiStandardErrors } from '../../common/http/api-standard-errors.decorator.js';
import { MessageResponseDto } from '../../common/http/message-response.dto.js';
import { CurrentUser } from '../../identity/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../identity/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../identity/guards/jwt-auth.guard.js';
import { CreateGroupDto } from './dto/create-group.dto.js';
import {
  GroupAttributesResponseDto,
  GroupDetailResponseDto,
  GroupListResponseDto,
  GroupResponseDto,
} from './dto/group-response.dto.js';
import { UpdateGroupDto } from './dto/update-group.dto.js';
import {
  CanCreateGroups,
  CanDeleteGroups,
  CanManageGroupAttributes,
  CanManageGroupMembers,
  CanReadGroups,
  CanUpdateGroups,
} from './groups.guards.js';
import { GroupsService } from './groups.service.js';
import type { GroupDetail, GroupView } from './groups.service.js';

/**
 * Group management (`/groups`).
 *
 * Groups are attribute pools: attaching an attribute grants it to every
 * member. `JwtAuthGuard` authenticates the caller; each route declares its
 * capability as a named guard (`CanManageGroupMembers`, ...) — superusers pass
 * everything. Grant-like changes additionally follow the delegation subset
 * rule inside `GroupsService`.
 */
@ApiTags('Groups')
@ApiBearerAuth('access-token')
@ApiStandardErrors()
@Controller('groups')
@UseGuards(JwtAuthGuard)
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  /**
   * `GET /groups` — all groups with their attribute keys.
   */
  @Get()
  @ApiOperation({ summary: 'List groups' })
  @ApiOkResponse({ type: GroupListResponseDto })
  @UseGuards(CanReadGroups)
  async list(): Promise<{ groups: GroupView[] }> {
    return { groups: await this.groups.list() };
  }

  /**
   * `POST /groups` — creates a group.
   */
  @Post()
  @ApiOperation({ summary: 'Create a group' })
  @ApiCreatedResponse({ type: GroupResponseDto })
  @UseGuards(CanCreateGroups)
  create(@Body() dto: CreateGroupDto): Promise<GroupView> {
    return this.groups.create({
      name: dto.name,
      description: dto.description ?? null,
    });
  }

  /**
   * `GET /groups/:id` — one group with attributes and member ids.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get one group with members' })
  @ApiOkResponse({ type: GroupDetailResponseDto })
  @UseGuards(CanReadGroups)
  detail(@Param('id', new ParseUUIDPipe()) id: string): Promise<GroupDetail> {
    return this.groups.detail(id);
  }

  /**
   * `PATCH /groups/:id` — updates name/description.
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Update a group' })
  @ApiOkResponse({ type: GroupResponseDto })
  @UseGuards(CanUpdateGroups)
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateGroupDto,
  ): Promise<GroupView> {
    return this.groups.update(id, {
      name: dto.name,
      description: dto.description,
    });
  }

  /**
   * `DELETE /groups/:id` — deletes a group (cascades links and memberships).
   */
  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete a group' })
  @ApiOkResponse({ type: MessageResponseDto })
  @UseGuards(CanDeleteGroups)
  async remove(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ message: string }> {
    await this.groups.remove(id);
    return { message: 'Group deleted.' };
  }

  /**
   * `PUT /groups/:id/attributes/:key` — attaches an attribute (idempotent;
   * subset rule applies).
   */
  @Put(':id/attributes/:key')
  @HttpCode(200)
  @ApiOperation({ summary: 'Attach an attribute to a group' })
  @ApiOkResponse({ type: GroupAttributesResponseDto })
  @UseGuards(CanManageGroupAttributes)
  async attachAttribute(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('key') key: string,
  ): Promise<{ attributes: string[] }> {
    return { attributes: await this.groups.attachAttribute(actor.id, id, key) };
  }

  /**
   * `DELETE /groups/:id/attributes/:key` — detaches an attribute (idempotent).
   */
  @Delete(':id/attributes/:key')
  @HttpCode(200)
  @ApiOperation({ summary: 'Detach an attribute from a group' })
  @ApiOkResponse({ type: GroupAttributesResponseDto })
  @UseGuards(CanManageGroupAttributes)
  async detachAttribute(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('key') key: string,
  ): Promise<{ attributes: string[] }> {
    return { attributes: await this.groups.detachAttribute(id, key) };
  }

  /**
   * `PUT /groups/:id/members/:userId` — adds a member (idempotent; the actor
   * must hold every attribute the group carries).
   */
  @Put(':id/members/:userId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Add a member to a group' })
  @ApiOkResponse({ type: MessageResponseDto })
  @UseGuards(CanManageGroupMembers)
  async addMember(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<{ message: string }> {
    await this.groups.addMember(actor.id, id, userId);
    return { message: 'Member added.' };
  }

  /**
   * `DELETE /groups/:id/members/:userId` — removes a member (idempotent).
   */
  @Delete(':id/members/:userId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove a member from a group' })
  @ApiOkResponse({ type: MessageResponseDto })
  @UseGuards(CanManageGroupMembers)
  async removeMember(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<{ message: string }> {
    await this.groups.removeMember(id, userId);
    return { message: 'Member removed.' };
  }
}
