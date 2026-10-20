import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { User } from '../../../users/user.entity.js';

/**
 * Pending two-sided email change for a verified account.
 *
 * The account keeps its current email until the owner approves the change from
 * that address (the approval token lives in `auth_tokens` as
 * `email_change_old`). One request per user: a new request replaces the
 * previous one, invalidating its approval link.
 *
 * Unverified accounts skip this table entirely — they own no confirmed address
 * to protect, so their email changes immediately.
 */
@Entity('email_change_requests')
@Index('uq_email_change_requests_user_id', ['userId'], { unique: true })
@Index('idx_email_change_requests_expires_at', ['expiresAt'])
export class EmailChangeRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // The unique index on `userId` (above) enforces one pending request per
  // account; `ManyToOne` avoids TypeORM inferring a second unique constraint
  // with a derived name. The FK name is pinned to the migration's constraint.
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'userId',
    foreignKeyConstraintName: 'FK_email_change_requests_user',
  })
  user: Relation<User>;

  @Column({ type: 'uuid' })
  userId: string;

  /** Normalized address the account will switch to once approved. */
  @Column({ type: 'varchar', length: 254 })
  newEmail: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  /** Kept in sync with the approval token: both expire after one hour. */
  @Column({ type: 'timestamptz' })
  expiresAt: Date;
}
