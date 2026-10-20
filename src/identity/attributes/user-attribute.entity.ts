import {
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { User } from '../users/user.entity.js';
import { Attribute } from './attribute.entity.js';

/**
 * A direct attribute grant on a user.
 *
 * The effective attribute set of a user is the union of these direct grants
 * and the attributes of every group the user belongs to.
 */
@Entity('user_attributes')
export class UserAttribute {
  @PrimaryColumn({ type: 'uuid' })
  userId: string;

  @PrimaryColumn({ type: 'varchar', length: 64 })
  attributeKey: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: Relation<User>;

  @ManyToOne(() => Attribute, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'attributeKey' })
  attribute: Relation<Attribute>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
