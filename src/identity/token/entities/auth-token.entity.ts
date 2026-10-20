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
import { User } from '../../users/user.entity.js';

/** Kind of single-use link a token row represents. */
export type AuthTokenType =
  'email_verify' | 'password_reset' | 'email_change_old';

/**
 * Single-use tokens backing email verification, password reset and the
 * old-address approval step of an email change.
 *
 * Only the SHA-256 hash is stored; consuming a token stamps `consumedAt`, and
 * issuing a new one of the same type invalidates any pending predecessor.
 */
@Entity('auth_tokens')
@Index('idx_auth_tokens_user_type', ['userId', 'type'])
@Index('idx_auth_tokens_expires_at', ['expiresAt'])
export class AuthToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: Relation<User>;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 32 })
  type: AuthTokenType;

  @Column({ type: 'varchar', length: 64, unique: true })
  tokenHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  consumedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
