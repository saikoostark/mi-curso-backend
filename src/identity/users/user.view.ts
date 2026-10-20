import { ApiProperty } from '@nestjs/swagger';
import type { User } from './user.entity.js';
import type { UserProfile } from './user-profile.entity.js';

/**
 * The profile-only part of a user response.
 *
 * This is a read model, not an entity: it names the display fields on their own
 * so a profile-focused surface can expose them without the account, while
 * `UserView` flattens both parts into the combined response.
 */
export class UserProfileView {
  @ApiProperty({ type: String, nullable: true, example: 'Jane' })
  firstName: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Doe' })
  lastName: string | null;

  @ApiProperty({ type: String, nullable: true, example: '+4915112345678' })
  phone: string | null;
}

/**
 * Public representation of a user: account fields plus the flattened profile.
 *
 * Credential material is never included. Self-service responses (`/auth/me`,
 * login and refresh) and the admin reads use this shape, so clients keep seeing
 * one object even though storage and services are split.
 */
export class UserView extends UserProfileView {
  @ApiProperty({
    format: 'uuid',
    example: '6f1a1e2a-2a5b-4f0e-9f1a-2a5b4f0e9f1a',
  })
  id: string;

  @ApiProperty({ format: 'email', example: 'jane@example.com' })
  email: string;

  @ApiProperty({ example: 'janedoe' })
  username: string;

  @ApiProperty({ example: false })
  isSuperuser: boolean;

  @ApiProperty({ example: true })
  emailVerified: boolean;

  @ApiProperty({
    format: 'date-time',
    nullable: true,
    description:
      'Soft-deletion timestamp; `null` for an active account. Admin reads can include deleted accounts explicitly.',
  })
  deletedAt: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-01-01T00:00:00.000Z' })
  createdAt: string;
}

/**
 * Flat database projection used by the admin read service.
 *
 * It mirrors `UserView` but keeps the raw verification timestamp, so the mapper
 * can derive `emailVerified` without selecting the password hash.
 */
export interface UserViewRow {
  id: string;
  email: string;
  username: string;
  isSuperuser: boolean;
  emailVerifiedAt: Date | string | null;
  deletedAt: Date | string | null;
  createdAt: Date | string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
}

/**
 * Maps the profile entity to its public read model.
 *
 * A missing profile is rendered as empty fields instead of leaking the
 * invariant violation into the API.
 *
 * @param profile - Profile row, when present.
 * @returns The profile view.
 */
export function toUserProfileView(
  profile: UserProfile | null,
): UserProfileView {
  return {
    firstName: profile?.firstName ?? null,
    lastName: profile?.lastName ?? null,
    phone: profile?.phone ?? null,
  };
}

/**
 * Combines an account and its profile into the flat public representation.
 *
 * @param user - Account row.
 * @param profile - Profile row, when present.
 * @returns The combined user view.
 */
export function toUserView(user: User, profile: UserProfile | null): UserView {
  const profileView = toUserProfileView(profile);

  return toUserViewFromRow({
    id: user.id,
    email: user.email,
    username: user.username,
    isSuperuser: user.isSuperuser,
    emailVerifiedAt: user.emailVerifiedAt,
    deletedAt: user.deletedAt,
    createdAt: user.createdAt,
    firstName: profileView.firstName,
    lastName: profileView.lastName,
    phone: profileView.phone,
  });
}

/**
 * Maps a flat admin-read projection into the public representation.
 *
 * @param row - Raw row joining `users` and `user_profiles`.
 * @returns The combined user view.
 */
export function toUserViewFromRow(row: UserViewRow): UserView {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    isSuperuser: row.isSuperuser,
    emailVerified: row.emailVerifiedAt !== null,
    deletedAt: row.deletedAt ? new Date(row.deletedAt).toISOString() : null,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}
