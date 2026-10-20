import { Module } from '@nestjs/common';
import { AdminAttributesModule } from './attributes/admin-attributes.module.js';
import { AdminAuditModule } from './audit/admin-audit.module.js';
import { AdminGroupsModule } from './groups/admin-groups.module.js';
import { AdminUsersModule } from './users/admin-users.module.js';

/**
 * Administration surface composition root.
 *
 * Every administrable resource gets its own sub-module (`AdminUsersModule`,
 * `AdminGroupsModule`, `AdminAttributesModule`), each owning its controller,
 * use-case service, concrete capability guards and state policies. Identity
 * supplies the record primitives, the shared authorization engine and the
 * refill-free authentication guard; the routes themselves are unchanged.
 */
@Module({
  imports: [
    AdminAttributesModule,
    AdminAuditModule,
    AdminGroupsModule,
    AdminUsersModule,
  ],
})
export class AdminModule {}
