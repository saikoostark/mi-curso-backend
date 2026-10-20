import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager } from 'typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity.js';
import { USER_ERRORS } from './users.error-codes.js';

/** Fully-resolved fields for an account record (no policy or uniqueness checks). */
export interface CreateUserRecordInput {
  email: string;
  username: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
  isSuperuser: boolean;
}

/**
 * Owns persistence access to the `users` table: account primitives only.
 *
 * Auth flows (`registration`, `session`, `account`, `recovery`) and the shared
 * authorization engine go through these primitives. Display data lives in
 * `UserProfilesService`; account and profile rows are created atomically by
 * `UserProvisioningService`, which is the only supported creation path.
 *
 * The administration use cases — verified creation, updates, deletion, paging
 * and attribute grants — live in `admin/users/` (`AdminUsersService` for
 * writes, `AdminUsersReadService` for projected reads). Account primitives
 * stay here; the admin read projection is the one deliberate exception that
 * queries the users repository for its joined projection.
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly repository: Repository<User>,
  ) {}

  /**
   * Finds a user by primary key.
   *
   * @param id - User id.
   * @returns The user or `null`.
   */
  findById(id: string): Promise<User | null> {
    return this.repository.findOne({ where: { id } });
  }

  /**
   * Finds a user by primary key, including soft-deleted accounts.
   *
   * @param id - User id.
   * @returns The user or `null`.
   */
  findByIdWithDeleted(id: string): Promise<User | null> {
    return this.repository.findOne({ where: { id }, withDeleted: true });
  }

  /**
   * Finds a user by primary key, failing when it does not exist.
   *
   * @param id - User id.
   * @returns The user.
   * @throws NotFoundException when no such user exists.
   */
  async getById(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException({
        code: USER_ERRORS.userNotFound,
        message: 'User not found.',
      });
    }

    return user;
  }

  /**
   * Finds a user by email or username.
   *
   * @param identifier - Normalized email or username.
   * @returns The user or `null`.
   */
  findByIdentifier(identifier: string): Promise<User | null> {
    return this.repository.findOne({
      where: [{ email: identifier }, { username: identifier }],
    });
  }

  /**
   * Finds a user by email address.
   *
   * @param email - Normalized email address.
   * @returns The user or `null`.
   */
  findByEmail(email: string): Promise<User | null> {
    return this.repository.findOne({ where: { email } });
  }

  /**
   * Finds a user by username.
   *
   * @param username - Normalized username.
   * @returns The user or `null`.
   */
  findByUsername(username: string): Promise<User | null> {
    return this.repository.findOne({ where: { username } });
  }

  /**
   * Checks whether an email address is already registered.
   *
   * @param email - Normalized email address.
   * @returns `true` when the email exists.
   */
  existsByEmail(email: string): Promise<boolean> {
    return this.repository.existsBy({ email });
  }

  /**
   * Checks whether a username is already taken.
   *
   * @param username - Normalized username.
   * @returns `true` when the username exists.
   */
  existsByUsername(username: string): Promise<boolean> {
    return this.repository.existsBy({ username });
  }

  /**
   * Persists a fully-resolved account record. Callers own policy, hashing and
   * uniqueness; this is the raw creation primitive used by
   * `UserProvisioningService` inside its transaction.
   *
   * @param input - Account fields, including verification and superuser flags.
   * @param manager - Optional transaction manager.
   * @returns The persisted user.
   */
  createRecord(
    input: CreateUserRecordInput,
    manager?: EntityManager,
  ): Promise<User> {
    const repository = manager?.getRepository(User) ?? this.repository;
    return repository.save(repository.create(input));
  }

  /**
   * Persists changes to an existing user record.
   *
   * @param user - User entity with the desired changes applied.
   * @returns The persisted user.
   */
  save(user: User): Promise<User> {
    return this.repository.save(user);
  }

  /**
   * Soft-deletes a user: the row survives with `deletedAt` set, its
   * email/username become reusable, and an admin can restore it later.
   *
   * Ephemeral state (sessions, pending tokens, email-change requests) must be
   * purged by the calling flow (`AccountDeletionService`); grants and group
   * memberships are deliberately kept so a restore brings them back.
   *
   * @param id - User id.
   */
  async softDeleteById(id: string): Promise<void> {
    await this.repository.softDelete({ id });
  }

  /**
   * Restores a soft-deleted user, optionally with replacement identifiers.
   *
   * Runs as one statement, so the account can never come back with
   * `deletedAt` cleared but the old conflicting identifiers — the partial
   * unique indexes reject the whole update instead.
   *
   * @param id - User id.
   * @param updates - Final email/username (possibly replacements), the
   * verification state and the forced-reset flag to store.
   */
  async restore(
    id: string,
    updates: {
      email: string;
      username: string;
      emailVerifiedAt: Date | null;
      passwordResetRequired: boolean;
    },
  ): Promise<void> {
    await this.repository.update({ id }, { ...updates, deletedAt: null });
  }

  /**
   * Marks the user's email as verified.
   *
   * @param userId - User id.
   * @param verifiedAt - Verification timestamp (defaults to now).
   */
  async setEmailVerified(
    userId: string,
    verifiedAt = new Date(),
  ): Promise<void> {
    await this.repository.update(
      { id: userId },
      { emailVerifiedAt: verifiedAt },
    );
  }

  /**
   * Replaces the user's password hash and clears any forced-reset flag: a
   * completed password update satisfies the restore requirement.
   *
   * @param userId - User id.
   * @param passwordHash - New scrypt hash.
   */
  async updatePasswordHash(
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    await this.repository.update(
      { id: userId },
      { passwordHash, passwordResetRequired: false },
    );
  }
}
