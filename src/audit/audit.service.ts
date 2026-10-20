import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { AuditLog } from './audit-log.entity.js';
import type { AuditLogView } from './audit-log.view.js';
import { toAuditLogView } from './audit-log.view.js';

/** Fields written by the audit interceptor. */
export interface AuditRecordInput {
  actorUserId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  userAgent: string | null;
  statusCode: number;
  success: boolean;
}

/** Filters and paging for `GET /audit-logs`. */
export interface AuditLogListOptions {
  offset: number;
  limit: number;
  /** Case-insensitive partial match on the route-based action. */
  action?: string;
  actorUserId?: string;
  targetType?: string;
  targetId?: string;
  success?: boolean;
  /** Inclusive lower bound on `createdAt`. */
  from?: Date;
  /** Inclusive upper bound on `createdAt`. */
  to?: Date;
}

/** One page of audit rows plus the total count. */
export interface AuditLogPage {
  items: AuditLogView[];
  total: number;
}

/**
 * Persistence and querying for the append-only audit trail.
 *
 * Writes are intentionally tiny and synchronous with the request; reads are
 * admin-only and use the `(createdAt, id)` ordering so paging stays stable when
 * several rows share a timestamp.
 */
@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly repository: Repository<AuditLog>,
  ) {}

  /**
   * Appends one audit row.
   *
   * @param input - Actor, action, target, outcome and request metadata.
   */
  async record(input: AuditRecordInput): Promise<void> {
    await this.repository.save(this.repository.create(input));
  }

  /**
   * Returns one filtered page, newest first.
   *
   * @param options - Filters, offset and limit.
   * @returns The page of views and the total number of matching rows.
   */
  async list(options: AuditLogListOptions): Promise<AuditLogPage> {
    const query = this.repository
      .createQueryBuilder('log')
      .orderBy('log.createdAt', 'DESC')
      .addOrderBy('log.id', 'DESC')
      .skip(options.offset)
      .take(options.limit);

    if (options.action) {
      query.andWhere('log.action ILIKE :action', {
        action: `%${options.action}%`,
      });
    }
    if (options.actorUserId) {
      query.andWhere('log.actorUserId = :actorUserId', {
        actorUserId: options.actorUserId,
      });
    }
    if (options.targetType) {
      query.andWhere('log.targetType = :targetType', {
        targetType: options.targetType,
      });
    }
    if (options.targetId) {
      query.andWhere('log.targetId = :targetId', {
        targetId: options.targetId,
      });
    }
    if (options.success !== undefined) {
      query.andWhere('log.success = :success', { success: options.success });
    }
    if (options.from) {
      query.andWhere('log.createdAt >= :from', { from: options.from });
    }
    if (options.to) {
      query.andWhere('log.createdAt <= :to', { to: options.to });
    }

    const [rows, total] = await query.getManyAndCount();
    return { items: rows.map(toAuditLogView), total };
  }

  /**
   * Deletes rows older than the retention window.
   *
   * @param retentionDays - Positive number of days to keep.
   * @returns Number of deleted rows.
   */
  async purgeExpired(retentionDays: number): Promise<number> {
    if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
      return 0;
    }

    const cutoff = new Date(
      Date.now() - Math.floor(retentionDays) * 24 * 60 * 60 * 1000,
    );
    const result = await this.repository.delete({
      createdAt: LessThan(cutoff),
    });
    return result.affected ?? 0;
  }
}
