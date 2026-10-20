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

/**
 * Refresh-token ledger implementing rotation with reuse detection.
 *
 * Every login (and every rotation) stores one row holding the SHA-256 hash of
 * the token. Rotation revokes the presented row and links the successor via
 * `replacedByHash`; presenting an already-revoked token is treated as theft
 * and revokes everything the user holds.
 *
 * Each row also journals the access token minted for the same session
 * (`accessJti`/`accessExpiresAt`), so a targeted logout can denylist exactly
 * that token for exactly its remaining lifetime — and `GET /auth/sessions` can
 * mark the caller's own session as current.
 */
@Entity('refresh_tokens')
@Index('idx_refresh_tokens_user_id', ['userId'])
@Index('idx_refresh_tokens_expires_at', ['expiresAt'])
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: Relation<User>;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  tokenHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  /** Hash of the token that replaced this one during rotation. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  replacedByHash: string | null;

  /** `jti` of the access token issued with this session (rotation replaces it). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  accessJti: string | null;

  /** Millisecond expiry of that access token (padded past its `exp` claim). */
  @Column({ type: 'timestamptz', nullable: true })
  accessExpiresAt: Date | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  userAgent: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string | null;

  /**
   * Last time this session was exercised (login or rotation). A rotated
   * session gets a fresh row, so this tracks activity without touching the
   * access-token journal.
   */
  @Column({ type: 'timestamptz', default: () => 'now()' })
  lastUsedAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
