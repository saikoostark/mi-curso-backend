import {
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { Attribute } from '../attributes/attribute.entity.js';
import { Group } from './group.entity.js';

/**
 * An attribute attached to a group.
 *
 * The composite primary key (`groupId`, `attributeKey`) makes repetitions
 * within a group impossible at the schema level.
 */
@Entity('group_attributes')
export class GroupAttribute {
  @PrimaryColumn({ type: 'uuid' })
  groupId: string;

  @PrimaryColumn({ type: 'varchar', length: 64 })
  attributeKey: string;

  @ManyToOne(() => Group, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'groupId' })
  group: Relation<Group>;

  @ManyToOne(() => Attribute, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'attributeKey' })
  attribute: Relation<Attribute>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
