import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One security-relevant HTTP mutation.
 *
 * Rows are append-only: the global interceptor writes them after a mutating
 * request (or its failure), and the scheduled cleanup removes rows older than
 * the configured retention. `actorUserId` is intentionally not a foreign key —
 * an audit record must outlive account deletion and must never cascade away.
 */
@Entity('audit_logs')
@Index('idx_audit_logs_created_at', ['createdAt'])
@Index('idx_audit_logs_actor_user_id', ['actorUserId'])
@Index('idx_audit_logs_action', ['action'])
// The action search is `%term%` (ILIKE): the trigram GIN index comes from the
// `AddSearchTrigramIndexes` migration and must not be touched by schema sync.
@Index('idx_audit_logs_action_trgm', { synchronize: false })
@Index('idx_audit_logs_target', ['targetType', 'targetId'])
@Index('idx_audit_logs_success_created_at', ['success', 'createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Authenticated actor, or `null` for anonymous flows (login, approval). */
  @Column({ type: 'uuid', nullable: true })
  actorUserId: string | null;

  /** Stable route-based action, e.g. `POST /users/:id/restore`. */
  @Column({ type: 'varchar', length: 200 })
  action: string;

  /** First path segment (`users`, `groups`, `auth`, ...). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  targetType: string | null;

  /** Route id/userId/key parameter, when the route carries one. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  targetId: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  userAgent: string | null;

  @Column({ type: 'int' })
  statusCode: number;

  @Column({ type: 'boolean' })
  success: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
