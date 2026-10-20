import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * The attribute catalog: one row per known attribute key.
 *
 * Rows are created by seed migrations (generated from the registry) and are
 * **never deleted** — an attribute that stops being declared in code is marked
 * with `deprecatedAt` instead, so historical grants remain readable and the
 * key can never be silently reused for different semantics.
 */
@Entity('attributes')
export class Attribute {
  /** Concrete `module:action` key, e.g. `users:create`. */
  @PrimaryColumn({ type: 'varchar', length: 64 })
  key: string;

  /** Human-readable description shown in admin UIs. */
  @Column({ type: 'varchar', length: 255 })
  description: string;

  /** Set when the key is no longer declared in code; deprecated keys cannot be granted. */
  @Column({ type: 'timestamptz', nullable: true })
  deprecatedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
