import { QueryFailedError } from 'typeorm';
import {
  restoreConflict,
  toUserConflict,
  userUniqueViolation,
} from '../identity/users/user-conflict.util.js';
import { USER_ERRORS } from '../identity/users/users.error-codes.js';
import { uniqueViolationConstraint } from './unique-violation.js';

/** Builds the raw Postgres driver error shape TypeORM exposes. */
function driverError(
  constraint?: string,
  code = '23505',
): Error & { code: string; constraint?: string } {
  return Object.assign(new Error('driver failure'), { code, constraint });
}

describe('uniqueViolationConstraint', () => {
  it('reads the constraint from a wrapped QueryFailedError', () => {
    const error = new QueryFailedError(
      'INSERT INTO "users" ...',
      [],
      driverError('uq_users_email_active'),
    );

    expect(uniqueViolationConstraint(error)).toBe('uq_users_email_active');
  });

  it('reads a raw driver error thrown outside TypeORM', () => {
    expect(
      uniqueViolationConstraint(driverError('uq_users_username_active')),
    ).toBe('uq_users_username_active');
  });

  it('ignores other SQLSTATEs and violations without a constraint name', () => {
    expect(uniqueViolationConstraint(driverError(undefined))).toBeNull();
    expect(
      uniqueViolationConstraint(driverError(undefined, '23503')),
    ).toBeNull();
    expect(uniqueViolationConstraint({ code: '23503' })).toBeNull();
  });

  it('returns null for values that are not driver errors', () => {
    expect(uniqueViolationConstraint(null)).toBeNull();
    expect(uniqueViolationConstraint('boom')).toBeNull();
    expect(uniqueViolationConstraint({})).toBeNull();
  });

  it('returns null for a QueryFailedError without a driver error', () => {
    // The real constructor requires a driver error, so simulate the metadata
    // shape it would have if the driver payload were missing.
    const error = Object.create(QueryFailedError.prototype) as QueryFailedError;

    expect(uniqueViolationConstraint(error)).toBeNull();
  });
});

describe('userUniqueViolation', () => {
  it.each([
    ['uq_users_email_active', 'email'],
    ['uq_users_username_active', 'username'],
  ] as const)('maps %s to %s', (constraint, field) => {
    expect(userUniqueViolation(driverError(constraint))).toBe(field);
  });

  it('ignores unrelated unique indexes', () => {
    expect(userUniqueViolation(driverError('uq_groups_name'))).toBeNull();
    expect(userUniqueViolation(new Error('boom'))).toBeNull();
  });
});

describe('toUserConflict', () => {
  it('turns an email collision into the canonical 409', () => {
    const error = toUserConflict(driverError('uq_users_email_active'));

    expect(error?.getStatus()).toBe(409);
    expect(error?.getResponse()).toMatchObject({
      code: USER_ERRORS.emailTaken,
      message: 'This email is already registered.',
    });
  });

  it('turns a username collision into the canonical 409', () => {
    const error = toUserConflict(driverError('uq_users_username_active'));

    expect(error?.getStatus()).toBe(409);
    expect(error?.getResponse()).toMatchObject({
      code: USER_ERRORS.usernameTaken,
      message: 'This username is already taken.',
    });
  });

  it('returns null so unrelated failures keep their original handling', () => {
    expect(toUserConflict(new Error('boom'))).toBeNull();
  });
});

describe('restoreConflict', () => {
  it('carries the colliding identifiers for the exception filter meta', () => {
    const error = restoreConflict(['email', 'username']);

    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({
      code: USER_ERRORS.restoreConflict,
      conflicts: ['email', 'username'],
    });
  });
});
