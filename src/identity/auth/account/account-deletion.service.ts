import { Injectable } from '@nestjs/common';
import { AuthTokenService } from '../../token/auth-token.service.js';
import { RefreshTokenService } from '../../token/refresh-token.service.js';
import { UsersService } from '../../users/users.service.js';
import { EmailChangeService } from './email-change.service.js';

/**
 * Soft deletion of a user account, shared by self-deletion and the admin
 * surface.
 *
 * The account row survives (`users.deletedAt`) so an admin can restore it;
 * grants and group memberships are kept implicitly and come back with the
 * restore. Ephemeral state is deliberately destroyed:
 *
 * - **Sessions**: refresh rows are revoked first (which also stamps the access
 * token watermark) and then deleted; a restored account logs in fresh.
 * - **Pending tokens**: verification/reset/email-change links must never
 *   outlive the deletion.
 * - **Pending email changes**: the request row is dropped, so a restore never
 *   resurrects a change the user no longer asked for.
 *
 * Identifier reuse falls out of the partial unique indexes created with
 * `users.deletedAt` (see `AddUserSoftDelete`); restoring an account whose
 * identifiers were meanwhile claimed is handled by `AdminUsersService.restore`.
 */
@Injectable()
export class AccountDeletionService {
  constructor(
    private readonly users: UsersService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly authTokens: AuthTokenService,
    private readonly emailChanges: EmailChangeService,
  ) {}

  /**
   * Soft-deletes the account and destroys its ephemeral state.
   *
   * @param userId - Account to delete.
   */
  async softDelete(userId: string): Promise<void> {
    await this.refreshTokens.revokeAllForUser(userId);
    await this.refreshTokens.purgeForUser(userId);
    await this.authTokens.purgeForUser(userId);
    await this.emailChanges.purgeForUser(userId);
    await this.users.softDeleteById(userId);
  }
}
