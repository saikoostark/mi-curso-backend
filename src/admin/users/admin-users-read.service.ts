import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { SelectQueryBuilder } from 'typeorm';
import { Repository } from 'typeorm';
import { UserProfile } from '../../identity/users/user-profile.entity.js';
import type { UserView, UserViewRow } from '../../identity/users/user.view.js';
import { toUserViewFromRow } from '../../identity/users/user.view.js';
import { User } from '../../identity/users/user.entity.js';

/** One page of combined user views plus the total count. */
export interface AdminUserPage {
  items: UserView[];
  total: number;
}

/** Whitelisted sort columns for the admin user list. */
export type AdminUserSortField = 'createdAt' | 'email' | 'username';

/** Sort direction for the admin user list. */
export type SortOrder = 'asc' | 'desc';

/** Which account states the admin list should include. */
export type AdminUserStatus = 'active' | 'deleted' | 'all';

/** Offset paging plus the optional admin filters. */
export interface AdminUserListOptions {
  offset: number;
  limit: number;
  /** Account state to include; defaults to active accounts only. */
  status?: AdminUserStatus;
  /** Case-insensitive partial match on email/username/profile names. */
  search?: string;
  emailVerified?: boolean;
  isSuperuser?: boolean;
  sort?: AdminUserSortField;
  order?: SortOrder;
}

/** SQL expressions of the whitelisted sort columns. */
const SORT_COLUMNS: Record<AdminUserSortField, string> = {
  createdAt: 'user.createdAt',
  email: 'user.email',
  username: 'user.username',
};

/**
 * Read model for the admin user surface.
 *
 * List and detail reads join `users` and `user_profiles` in a single query and
 * select only the columns the response needs. The password hash is never part
 * of the projection. Ordering is deterministic (`createdAt DESC, id DESC` by
 * default) so offset pagination cannot return a row twice or skip one when
 * timestamps tie; every sortable column keeps the id tie-breaker.
 */
@Injectable()
export class AdminUsersReadService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  /**
   * Lists users page by page with optional filters and sorting.
   *
   * @param options - Paging, filters and whitelisted sort options.
   * @returns The page of combined views and the total number of matching users.
   */
  async list(options: AdminUserListOptions): Promise<AdminUserPage> {
    const sort = options.sort ?? 'createdAt';
    const direction = (options.order ?? 'desc').toUpperCase() as 'ASC' | 'DESC';

    const status = options.status ?? 'active';
    const [rows, total] = await Promise.all([
      this.applyFilters(this.readQuery(status), options)
        .orderBy(SORT_COLUMNS[sort], direction)
        .addOrderBy('user.id', direction)
        .offset(options.offset)
        .limit(options.limit)
        .getRawMany<UserViewRow>(),
      this.applyFilters(this.readQuery(status), options).getCount(),
    ]);

    return { items: rows.map(toUserViewFromRow), total };
  }

  /**
   * Loads one account with its profile for the admin detail route.
   *
   * @param id - User id.
   * @param withDeleted - Include a soft-deleted account.
   * @returns The combined view or `null` when no such user exists.
   */
  async detail(id: string, withDeleted = false): Promise<UserView | null> {
    const query = this.readQuery(withDeleted ? 'all' : 'active').andWhere(
      'user.id = :id',
      { id },
    );
    if (!withDeleted) {
      query.andWhere('user.deletedAt IS NULL');
    }

    const row = await query.getRawOne<UserViewRow>();
    return row ? toUserViewFromRow(row) : null;
  }

  /**
   * Applies the optional filters to the shared projection.
   *
   * @param query - Base query (already excludes soft-deleted accounts).
   * @param options - Filters to apply.
   * @returns The same query builder, for chaining.
   */
  private applyFilters(
    query: SelectQueryBuilder<User>,
    options: Pick<
      AdminUserListOptions,
      'status' | 'search' | 'emailVerified' | 'isSuperuser'
    >,
  ): SelectQueryBuilder<User> {
    const status = options.status ?? 'active';
    if (status === 'active') {
      query.andWhere('user.deletedAt IS NULL');
    } else if (status === 'deleted') {
      query.andWhere('user.deletedAt IS NOT NULL');
    }

    if (options.search) {
      query.andWhere(
        `(user.email ILIKE :search ESCAPE '\\'` +
          ` OR user.username ILIKE :search ESCAPE '\\'` +
          ` OR profile.firstName ILIKE :search ESCAPE '\\'` +
          ` OR profile.lastName ILIKE :search ESCAPE '\\')`,
        { search: `%${escapeLike(options.search)}%` },
      );
    }

    if (options.emailVerified !== undefined) {
      query.andWhere(
        options.emailVerified
          ? 'user.emailVerifiedAt IS NOT NULL'
          : 'user.emailVerifiedAt IS NULL',
      );
    }

    if (options.isSuperuser !== undefined) {
      query.andWhere('user.isSuperuser = :isSuperuser', {
        isSuperuser: options.isSuperuser,
      });
    }

    return query;
  }

  /**
   * Builds the shared projection joining the account and its profile.
   *
   * Only response columns are selected — notably never `user.passwordHash`.
   * Account-state filtering happens in `applyFilters`, so the same base query
   * serves rows and total count and `pagination.total` stays consistent.
   */
  private readQuery(status: AdminUserStatus = 'active') {
    const query = this.users
      .createQueryBuilder('user')
      .leftJoin(UserProfile, 'profile', 'profile.userId = user.id');
    if (status !== 'active') {
      // TypeORM's soft-delete filter is applied at execution unless the query
      // explicitly opts in; the explicit WHERE in `applyFilters` then selects
      // deleted-only or both states.
      query.withDeleted();
    }

    return query
      .select('user.id', 'id')
      .addSelect('user.email', 'email')
      .addSelect('user.username', 'username')
      .addSelect('user.isSuperuser', 'isSuperuser')
      .addSelect('user.emailVerifiedAt', 'emailVerifiedAt')
      .addSelect('user.deletedAt', 'deletedAt')
      .addSelect('user.createdAt', 'createdAt')
      .addSelect('profile.firstName', 'firstName')
      .addSelect('profile.lastName', 'lastName')
      .addSelect('profile.phone', 'phone');
  }
}

/**
 * Escapes LIKE wildcards so the search term matches literally.
 *
 * The pattern is still passed as a bound parameter; escaping only prevents a
 * user-supplied `%`/`_` from turning the search into a match-all.
 *
 * @param value - Raw search term.
 * @returns The term with `\`, `%` and `_` escaped for `LIKE ... ESCAPE '\'`.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
