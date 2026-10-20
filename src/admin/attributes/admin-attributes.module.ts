import { Module } from '@nestjs/common';
import { IdentityModule } from '../../identity/identity.module.js';
import { AttributesController } from './attributes.controller.js';

/**
 * The read-only attribute catalog (`/attributes`).
 *
 * Imports `IdentityModule` for the authorization engine (catalog query) and
 * the JWT guard. Every authenticated user may read the catalog; no capability
 * guard is attached on purpose.
 */
@Module({
  imports: [IdentityModule],
  controllers: [AttributesController],
})
export class AdminAttributesModule {}
