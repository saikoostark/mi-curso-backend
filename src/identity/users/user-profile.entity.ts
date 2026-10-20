import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { User } from './user.entity.js';

/**
 * Display data of a user account.
 *
 * Account and profile are separate 1:1 rows: `users` owns identity, credentials
 * and state, while this table owns only the mutable display fields. The shared
 * primary key (`userId`) enforces exactly one profile per account, and the
 * foreign key cascades on user deletion.
 *
 * A profile row is created together with its account by
 * `UserProvisioningService`; reading a user without its profile is a bug, not a
 * supported state.
 */
// Trigram GIN indexes are created by the `AddSearchTrigramIndexes` migration;
// `synchronize: false` keeps TypeORM migration generation from dropping them.
@Index('idx_user_profiles_first_name_trgm', { synchronize: false })
@Index('idx_user_profiles_last_name_trgm', { synchronize: false })
@Entity('user_profiles')
export class UserProfile {
  @PrimaryColumn({ type: 'uuid' })
  userId: string;

  @OneToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  // The constraint name is pinned to the one used by the hand-written
  // `SplitUserProfiles` migration; without it TypeORM derives a hash name and
  // `migration:generate` would propose a pointless rename.
  @JoinColumn({
    name: 'userId',
    foreignKeyConstraintName: 'FK_user_profiles_userId',
  })
  user: Relation<User>;

  @Column({ type: 'varchar', length: 100, nullable: true })
  firstName: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  lastName: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
