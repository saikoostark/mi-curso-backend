/**
 * Balanced password policy (see AGENTS.md -> Security): minimum length plus
 * character-class requirements, and no personal identifiers inside the
 * password. Shared by DTO validation flows, the auth service and CI scripts so
 * every entry point enforces the exact same rules.
 */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/** Personal identifiers a password must not contain. */
export interface PasswordPolicyContext {
  email: string;
  username: string;
}

/**
 * Validates a password against the balanced policy.
 *
 * @param password - Candidate password.
 * @param context - The user's email/username (checked for inclusion).
 * @returns Human-readable violations; an empty array means the password is OK.
 */
export function validatePasswordPolicy(
  password: string,
  context: PasswordPolicyContext,
): string[] {
  const violations: string[] = [];

  if (password.length < PASSWORD_MIN_LENGTH) {
    violations.push(
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`,
    );
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    violations.push(
      `Password must be at most ${PASSWORD_MAX_LENGTH} characters long.`,
    );
  }

  if (!/[a-z]/.test(password)) {
    violations.push('Password must contain at least one lowercase letter.');
  }

  if (!/[A-Z]/.test(password)) {
    violations.push('Password must contain at least one uppercase letter.');
  }

  if (!/\d/.test(password)) {
    violations.push('Password must contain at least one digit.');
  }

  const lowered = password.toLowerCase();

  // Short identifiers (e.g. "a") would reject almost every password, so the
  // containment check only applies from 3 characters on.
  const emailLocalPart = context.email.split('@')[0]?.toLowerCase() ?? '';
  if (emailLocalPart.length >= 3 && lowered.includes(emailLocalPart)) {
    violations.push('Password must not contain your email address.');
  }

  const username = context.username.toLowerCase();
  if (username.length >= 3 && lowered.includes(username)) {
    violations.push('Password must not contain your username.');
  }

  return violations;
}
