import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GroupAttribute } from '../../identity/groups/group-attribute.entity.js';
import { GroupMember } from '../../identity/groups/group-member.entity.js';
import { Group } from '../../identity/groups/group.entity.js';
import { IdentityModule } from '../../identity/identity.module.js';
import { GroupsController } from './groups.controller.js';
import { GroupsService } from './groups.service.js';
import {
  CanCreateGroups,
  CanDeleteGroups,
  CanManageGroupAttributes,
  CanManageGroupMembers,
  CanReadGroups,
  CanUpdateGroups,
} from './groups.guards.js';

/**
 * Administration of groups (`/groups`): controller, use-case service and
 * capability guards.
 *
 * Imports `IdentityModule` for the authorization engine, user record
 * primitives and the JWT guard; registers the group repositories it owns at
 * the management level (the entities themselves stay in identity).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Group, GroupAttribute, GroupMember]),
    IdentityModule,
  ],
  controllers: [GroupsController],
  providers: [
    GroupsService,
    CanCreateGroups,
    CanDeleteGroups,
    CanManageGroupAttributes,
    CanManageGroupMembers,
    CanReadGroups,
    CanUpdateGroups,
  ],
})
export class AdminGroupsModule {}
