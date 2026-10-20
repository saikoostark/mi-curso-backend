import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A registered account: identity, credentials and account state.
 *
 * `email` and `username` are stored normalized (trimmed, lowercased) so that
 * both uniqueness and login lookups are case-insensitive. A user cannot log in
 * until `emailVerifiedAt` is set; `isSuperuser` bypasses attribute checks
 * (see the ABAC phase) but never policy protections around superuser records.
 *
 * Display data (first/last name and phone) lives in the 1:1 `UserProfile`
 * record (`user_profiles`), created together with the account by
 * `UserProvisioningService`.
 *
 * Deletion is soft: `deletedAt` marks the account as gone while the row (and
 * its grants/memberships) survives for an admin restore. Uniqueness is
 * therefore enforced by **partial** unique indexes covering active rows only —
 * a deleted account's email/username become immediately reusable, and
 * restoring one that collided with a new registration requires replacement
 * identifiers (handled in `AdminUsersService.restore`).
 *
 * The composite index serves the deterministic admin ordering
 * (`createdAt DESC, id DESC`) through a backward index scan.
 */
@Index('idx_users_created_at_id', ['createdAt', 'id'])
// Trigram GIN indexes are created by the `AddSearchTrigramIndexes` migration;
// `synchronize: false` keeps TypeORM migration generation from dropping them.
@Index('idx_users_email_trgm', { synchronize: false })
@Index('idx_users_username_trgm', { synchronize: false })
@Index('uq_users_email_active', ['email'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@Index('uq_users_username_active', ['username'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 254 })
  email: string;

  @Column({ type: 'varchar', length: 30 })
  username: string;

  @Column({ type: 'text' })
  passwordHash: string;

  @Column({ type: 'timestamptz', nullable: true })
  emailVerifiedAt: Date | null;

  @Column({ type: 'boolean', default: false })
  isSuperuser: boolean;

  /**
   * Set by an admin restore: the stored password is no longer sufficient to
   * log in, and the account must complete the reset link mailed at restore
   * time. The password-update tail clears the flag.
   */
  @Column({ type: 'boolean', default: false })
  passwordResetRequired: boolean;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
