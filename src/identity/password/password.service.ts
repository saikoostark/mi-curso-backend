import { BadRequestException, Injectable } from '@nestjs/common';
import {
  PasswordPolicyContext,
  validatePasswordPolicy,
} from './password-policy.js';
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
} from './password.util.js';
import { PASSWORD_ERRORS } from './password.error-codes.js';

/**
 * Thin DI-friendly wrapper around the pure scrypt helpers.
 *
 * Stateless and dependency-free, so CLI scripts can also do
 * `new PasswordService()` without booting the Nest container. Owns the two
 * assertion shapes shared by every password flow (registration, change, reset
 * and admin creation): confirmation matching and policy enforcement.
 */
@Injectable()
export class PasswordService {
  /**
   * Validates a password against the balanced policy.
   *
   * @param password - Candidate password.
   * @param context - The user's email/username.
   * @returns Violations; empty when the password passes.
   */
  validatePolicy(password: string, context: PasswordPolicyContext): string[] {
    return validatePasswordPolicy(password, context);
  }

  /**
   * Asserts that a password and its confirmation match.
   *
   * @param password - Chosen password.
   * @param confirm - Confirmation entered by the user.
   * @throws BadRequestException with code `password_mismatch`.
   */
  assertMatch(password: string, confirm: string): void {
    if (password !== confirm) {
      throw new BadRequestException({
        code: PASSWORD_ERRORS.passwordMismatch,
        message: 'Password confirmation does not match.',
      });
    }
  }

  /**
   * Asserts that a password passes the policy.
   *
   * @param password - Candidate password.
   * @param context - The user's email/username (checked for inclusion).
   * @throws BadRequestException with code `password_policy` listing every
   * violation.
   */
  assertValid(password: string, context: PasswordPolicyContext): void {
    const violations = this.validatePolicy(password, context);
    if (violations.length > 0) {
      throw new BadRequestException({
        code: PASSWORD_ERRORS.passwordPolicy,
        message: violations,
      });
    }
  }

  /**
   * Hashes a password for storage.
   *
   * @param password - Plain-text password.
   * @returns Stored scrypt hash.
   */
  hash(password: string): Promise<string> {
    return hashPassword(password);
  }

  /**
   * Verifies a password, always paying the full scrypt cost even when the
   * account does not exist (`storedHash === null`) so response timing cannot
   * reveal account existence.
   *
   * @param password - Plain-text candidate.
   * @param storedHash - Stored hash, or `null` for unknown accounts.
   * @returns `true` when the password matches.
   */
  verify(password: string, storedHash: string | null): Promise<boolean> {
    return verifyPassword(password, storedHash ?? DUMMY_PASSWORD_HASH);
  }
}
