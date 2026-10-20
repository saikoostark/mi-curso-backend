import { validatePasswordPolicy } from './password-policy.js';

describe('validatePasswordPolicy', () => {
  const context = { email: 'jane.doe@example.com', username: 'janedoe' };

  it('accepts a compliant password', () => {
    expect(validatePasswordPolicy('Str0ngPassphrase', context)).toEqual([]);
  });

  it('rejects a password that is too short', () => {
    const violations = validatePasswordPolicy('Sh0rt', context);
    expect(violations.some((violation) => violation.includes('at least'))).toBe(
      true,
    );
  });

  it('rejects a password that is too long', () => {
    const violations = validatePasswordPolicy(`A1${'x'.repeat(200)}`, context);
    expect(violations.some((violation) => violation.includes('at most'))).toBe(
      true,
    );
  });

  it('requires an uppercase letter', () => {
    const violations = validatePasswordPolicy('lowercase1only', context);
    expect(
      violations.some((violation) => violation.includes('uppercase')),
    ).toBe(true);
  });

  it('requires a lowercase letter', () => {
    const violations = validatePasswordPolicy('UPPERCASE1ONLY', context);
    expect(
      violations.some((violation) => violation.includes('lowercase')),
    ).toBe(true);
  });

  it('requires a digit', () => {
    const violations = validatePasswordPolicy('NoDigitsHereAtAll', context);
    expect(violations.some((violation) => violation.includes('digit'))).toBe(
      true,
    );
  });

  it('rejects the email local part inside the password', () => {
    const violations = validatePasswordPolicy('jane.doe1PassW', context);
    expect(violations.some((violation) => violation.includes('email'))).toBe(
      true,
    );
  });

  it('rejects the username inside the password (case-insensitively)', () => {
    const violations = validatePasswordPolicy('Janedoe1PassW', context);
    expect(violations.some((violation) => violation.includes('username'))).toBe(
      true,
    );
  });

  it('ignores very short email local parts', () => {
    const violations = validatePasswordPolicy('Amazing1PassW', {
      email: 'a@example.com',
      username: 'b',
    });
    expect(violations).toEqual([]);
  });

  it('reports every violation at once', () => {
    const violations = validatePasswordPolicy('short', context);
    expect(violations.length).toBeGreaterThan(2);
  });
});
