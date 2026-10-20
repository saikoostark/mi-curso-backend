import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../identity/decorators/current-user.decorator.js';
import type { User } from '../../identity/users/user.entity.js';
import { ADMIN_USER_ERRORS } from './users.error-codes.js';

/**
 * State-dependent policy of the users management part.
 *
 * Unlike guards — which only inspect the request (the actor and the
 * attributes carried on it) — this policy needs the state of another object:
 * the target account's `isSuperuser` flag. It is therefore **called from the
 * flow** (admin services, right after the target is loaded) and never attached
 * as a decorator; a guard could not see the loaded target.
 */
@Injectable()
export class SuperuserProtectionPolicy {
  /**
   * Asserts that this actor may modify the given (already-loaded) account.
   *
   * Non-superusers holding `users:update` etc. must not touch superuser rows —
   * otherwise they could lock the real owner out.
   *
   * @param actor - Authenticated caller.
   * @param target - The target account, loaded by the calling flow.
   * @throws ForbiddenException when the target is a superuser and the actor is
   * not.
   */
  assertCanModify(actor: AuthenticatedUser, target: User): void {
    if (!target.isSuperuser || actor.isSuperuser) {
      return;
    }

    throw new ForbiddenException({
      code: ADMIN_USER_ERRORS.superuserProtected,
      message: 'Only a superuser can modify a superuser account.',
    });
  }
}
