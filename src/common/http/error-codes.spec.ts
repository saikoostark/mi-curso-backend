import { GROUP_ERRORS } from '../../admin/groups/groups.error-codes.js';
import { ADMIN_USER_ERRORS } from '../../admin/users/users.error-codes.js';
import { ATTRIBUTE_ERRORS } from '../../identity/attributes/attributes.error-codes.js';
import { AUTH_ERRORS } from '../../identity/auth/auth.error-codes.js';
import { PASSWORD_ERRORS } from '../../identity/password/password.error-codes.js';
import { TOKEN_ERRORS } from '../../identity/token/token.error-codes.js';
import { USER_ERRORS } from '../../identity/users/users.error-codes.js';
import { COMMON_ERROR_CODES } from './error-codes.js';

/**
 * Every public error-code map, grouped by its owning module.
 *
 * Keeping them in one test is deliberate: duplicate or malformed values would
 * make the wire contract ambiguous even though each map is typed on its own.
 */
const CODE_GROUPS = {
  common: Object.values(COMMON_ERROR_CODES),
  user: Object.values(USER_ERRORS),
  password: Object.values(PASSWORD_ERRORS),
  auth: Object.values(AUTH_ERRORS),
  token: Object.values(TOKEN_ERRORS),
  attributes: Object.values(ATTRIBUTE_ERRORS),
  adminUser: Object.values(ADMIN_USER_ERRORS),
  group: Object.values(GROUP_ERRORS),
};

describe('API error codes', () => {
  it('uses lowercase snake_case values', () => {
    for (const [group, codes] of Object.entries(CODE_GROUPS)) {
      for (const code of codes) {
        expect(code, `${group} code "${code}"`).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    }
  });

  it('does not reuse a code across maps', () => {
    const codes = Object.values(CODE_GROUPS).flat();
    const duplicates = codes.filter(
      (code, index) => codes.indexOf(code) !== index,
    );

    expect(duplicates).toEqual([]);
  });
});
