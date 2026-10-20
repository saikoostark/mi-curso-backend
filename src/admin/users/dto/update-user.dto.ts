import { IntersectionType } from '@nestjs/swagger';
import { UpdateAccountDto } from './update-account.dto.js';
import { UpdateUserProfileDto } from './update-user-profile.dto.js';

/**
 * Payload for `PATCH /users/:id`.
 *
 * The HTTP contract stays a single flat object, but the validators are split by
 * domain: `UpdateAccountDto` owns the identity columns and
 * `UpdateUserProfileDto` owns the display fields. The controller forwards each
 * half to its own admin service.
 */
export class UpdateUserDto extends IntersectionType(
  UpdateAccountDto,
  UpdateUserProfileDto,
) {}
