import { UpdateAccountDto } from './update-account.dto.js';

/**
 * Payload for `POST /users/:id/restore`.
 *
 * Both replacement identifiers are optional: when the stored email/username
 * are still free the account is restored as-is, otherwise the 409 lists the
 * collisions (`meta.conflicts`) and the admin retries with new values. The
 * validators are the same identity validators `POST /users` and
 * `PATCH /users/:id` use, including normalization.
 */
export class RestoreUserDto extends UpdateAccountDto {}
