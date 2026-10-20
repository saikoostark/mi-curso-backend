import {
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { User } from '../users/user.entity.js';
import { Group } from './group.entity.js';

/**
 * Membership of a user in a group.
 *
 * The composite primary key (`userId`, `groupId`) prevents duplicate joins;
 * the extra index serves the reverse direction (listing a group's members).
 */
@Entity('user_groups')
@Index('idx_user_groups_group_id', ['groupId'])
export class GroupMember {
  @PrimaryColumn({ type: 'uuid' })
  userId: string;

  @PrimaryColumn({ type: 'uuid' })
  groupId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: Relation<User>;

  @ManyToOne(() => Group, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'groupId' })
  group: Relation<Group>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
