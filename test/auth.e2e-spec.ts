import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { COMMON_ERROR_CODES } from '../src/common/http/error-codes.js';
import { AUTH_ERRORS } from '../src/identity/auth/auth.error-codes.js';
import { PASSWORD_ERRORS } from '../src/identity/password/password.error-codes.js';
import { TOKEN_ERRORS } from '../src/identity/token/token.error-codes.js';
import { USER_ERRORS } from '../src/identity/users/users.error-codes.js';
import { createE2eApp } from './setup/app.js';
import { extractToken, findLatestEmail } from './setup/outbox.js';
import { clearAuthKeys } from './setup/redis.js';

const PASSWORD = 'Str0ngPassw';
const NEW_PASSWORD = 'NewStr0ngPassw';

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let counter = 0;

  beforeAll(async () => {
    app = await createE2eApp();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // The test database is disposable (see AGENTS.md); wipe everything the
    // auth flows touch, plus the auth:* keys in the dedicated Redis database.
    await dataSource.query(
      'TRUNCATE TABLE refresh_tokens, auth_tokens, users CASCADE',
    );
    await clearAuthKeys();
  });

  /** Unique email/username pair per call. */
  function uniqueIdentity(prefix: string): {
    email: string;
    username: string;
  } {
    counter += 1;
    // Base-36 timestamp keeps usernames within the 30-character policy even
    // for long prefixes (a decimal epoch alone would push e.g.
    // `logoutothers` past the limit).
    const tag = `${prefix}-${Date.now().toString(36)}-${counter}`;
    return {
      email: `${tag}@example.com`,
      username: `u_${tag.replace(/-/g, '_')}`,
    };
  }

  /** Registers a user and consumes the verification link from the outbox. */
  async function registerAndVerify(
    email: string,
    username: string,
    password = PASSWORD,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, username, password, passwordConfirm: password })
      .expect(201);

    const message = await findLatestEmail(email);
    await request(app.getHttpServer())
      .get('/auth/verify-email')
      .query({ token: extractToken(message.text) })
      .expect(200);
  }

  /** Pulls the refresh cookie out of a Set-Cookie header list. */
  function refreshCookieOf(response: request.Response): string {
    const header = response.headers['set-cookie'];
    const cookies: string[] = Array.isArray(header)
      ? header
      : header
        ? [header]
        : [];
    const cookie = cookies.find(
      (value) =>
        value.startsWith('refresh_token=') &&
        !value.startsWith('refresh_token=;'),
    );

    if (!cookie) {
      throw new Error('refresh cookie missing from response');
    }

    return cookie;
  }

  /** Reduces a Set-Cookie string to the `name=value` pair for replaying. */
  function cookiePair(cookie: string): string {
    return cookie.split(';')[0];
  }

  /** Bearer header helper. */
  function bearer(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  describe('registration', () => {
    it('registers an unverified account and writes the verification email', async () => {
      const { email, username } = uniqueIdentity('register');

      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email,
          username,
          password: PASSWORD,
          passwordConfirm: PASSWORD,
        })
        .expect(201);

      expect(response.body.data.message).toContain('Registration successful');

      const message = await findLatestEmail(email);
      expect(message.subject).toBe('Verify your email');
      expect(extractToken(message.text)).toBeTruthy();
    });

    it('rejects duplicate emails and usernames', async () => {
      const { email, username } = uniqueIdentity('dupe');

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email,
          username,
          password: PASSWORD,
          passwordConfirm: PASSWORD,
        })
        .expect(201);

      const duplicateEmail = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email,
          username: `${username}_x`,
          password: PASSWORD,
          passwordConfirm: PASSWORD,
        })
        .expect(409);
      expect(duplicateEmail.body.error.code).toBe(USER_ERRORS.emailTaken);

      const duplicateUsername = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: `other-${email}`,
          username,
          password: PASSWORD,
          passwordConfirm: PASSWORD,
        })
        .expect(409);
      expect(duplicateUsername.body.error.code).toBe(USER_ERRORS.usernameTaken);
    });

    it('enforces the password policy', async () => {
      const { email, username } = uniqueIdentity('policy');

      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email,
          username,
          password: 'lowercaseandnodigit',
          passwordConfirm: 'lowercaseandnodigit',
        })
        .expect(400);

      expect(response.body.error.code).toBe(PASSWORD_ERRORS.passwordPolicy);
    });

    it('rejects unknown request fields', async () => {
      const { email, username } = uniqueIdentity('strict');

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email,
          username,
          password: PASSWORD,
          passwordConfirm: PASSWORD,
          isSuperuser: true,
        })
        .expect(400);
    });
  });

  describe('email verification', () => {
    it('rejects unknown verification tokens', async () => {
      const response = await request(app.getHttpServer())
        .get('/auth/verify-email')
        .query({ token: 'not-a-real-token' })
        .expect(400);

      expect(response.body.error.code).toBe(TOKEN_ERRORS.invalidToken);
    });

    it('blocks login until the email is verified', async () => {
      const { email, username } = uniqueIdentity('unverified');

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email,
          username,
          password: PASSWORD,
          passwordConfirm: PASSWORD,
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: email, password: PASSWORD })
        .expect(403);

      expect(response.body.error.code).toBe(AUTH_ERRORS.emailNotVerified);
    });
  });

  describe('login and sessions', () => {
    it('logs in, returns cookies with the right attributes, and rotates on refresh', async () => {
      const { email, username } = uniqueIdentity('session');
      await registerAndVerify(email, username);

      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: email, password: PASSWORD })
        .expect(200);

      expect(loginResponse.body.data.user).toMatchObject({
        email,
        username,
        emailVerified: true,
      });

      const cookie = refreshCookieOf(loginResponse);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Path=/auth');
      expect(cookie).toContain('SameSite=Strict');

      // Pre-widening cookies are cleared on every write so they cannot shadow
      // the new `/auth` cookie.
      const rawSetCookies = loginResponse.headers['set-cookie'];
      const setCookies = Array.isArray(rawSetCookies)
        ? rawSetCookies
        : [rawSetCookies];
      expect(
        setCookies.some(
          (value) =>
            typeof value === 'string' &&
            value.startsWith('refresh_token=;') &&
            value.includes('Path=/auth/refresh'),
        ),
      ).toBe(true);

      await request(app.getHttpServer())
        .get('/auth/me')
        .set(bearer(loginResponse.body.data.accessToken))
        .expect(200);

      const agent = request.agent(app.getHttpServer());
      const refreshResponse = await agent
        .post('/auth/refresh')
        .set('Cookie', cookiePair(cookie))
        .expect(200);

      await request(app.getHttpServer())
        .get('/auth/me')
        .set(bearer(refreshResponse.body.data.accessToken))
        .expect(200);
    });

    it('caps active sessions and revokes the oldest on login', async () => {
      const { email, username } = uniqueIdentity('sessioncap');
      await registerAndVerify(email, username);

      const accessTokens: string[] = [];
      for (let index = 0; index < 11; index += 1) {
        const login = await request(app.getHttpServer())
          .post('/auth/login')
          .send({ identifier: email, password: PASSWORD })
          .expect(200);
        accessTokens.push(login.body.data.accessToken as string);

        // Each login consumes the identifier rate-limit budget; clearing the
        // auth keys keeps this test focused on the session cap.
        if (index < 10) {
          await clearAuthKeys();
        }
      }

      const sessions = await request(app.getHttpServer())
        .get('/auth/sessions')
        .set(bearer(accessTokens[10]))
        .expect(200);
      expect(sessions.body.data.sessions).toHaveLength(10);
      expect(
        (sessions.body.data.sessions as Array<{ current: boolean }>).filter(
          (session) => session.current,
        ),
      ).toHaveLength(1);
      expect(sessions.body.data.sessions[0]).toHaveProperty('lastUsedAt');

      // The oldest login was evicted, the next one survived.
      const oldest = await request(app.getHttpServer())
        .get('/auth/me')
        .set(bearer(accessTokens[0]))
        .expect(401);
      expect(oldest.body.error.code).toBe(TOKEN_ERRORS.tokenRevoked);
      await request(app.getHttpServer())
        .get('/auth/me')
        .set(bearer(accessTokens[1]))
        .expect(200);
    });

    it('logs in by username too', async () => {
      const { email, username } = uniqueIdentity('byusername');
      await registerAndVerify(email, username);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: username, password: PASSWORD })
        .expect(200);
    });

    it('detects refresh token reuse and kills every session', async () => {
      const { email, username } = uniqueIdentity('reuse');
      await registerAndVerify(email, username);

      const agent = request.agent(app.getHttpServer());
      const loginResponse = await agent
        .post('/auth/login')
        .send({ identifier: email, password: PASSWORD })
        .expect(200);
      const firstCookie = refreshCookieOf(loginResponse);

      // First refresh rotates successfully.
      await agent.post('/auth/refresh').expect(200);

      // Replaying the rotated cookie is treated as theft...
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', cookiePair(firstCookie))
        .expect(401);

      // ...and the whole family is revoked, including the agent's fresh one.
      await agent.post('/auth/refresh').expect(401);

      // Access tokens die too (watermark).
      await request(app.getHttpServer())
        .get('/auth/me')
        .set(bearer(loginResponse.body.data.accessToken))
        .expect(401);
    });

    it('logs out of all devices, revoking access and refresh tokens', async () => {
      const { email, username } = uniqueIdentity('logout');
      await registerAndVerify(email, username);

      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: email, password: PASSWORD })
        .expect(200);
      const accessToken = loginResponse.body.data.accessToken as string;
      const cookie = refreshCookieOf(loginResponse);

      await request(app.getHttpServer())
        .post('/auth/logout')
        .set(bearer(accessToken))
        .expect(200);

      const me = await request(app.getHttpServer())
        .get('/auth/me')
        .set(bearer(accessToken))
        .expect(401);
      expect(me.body.error.code).toBe(TOKEN_ERRORS.tokenRevoked);

      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', cookiePair(cookie))
        .expect(401);
    });

    it('rate limits login after repeated failures', async () => {
      const { email, username } = uniqueIdentity('ratelimit');
      await registerAndVerify(email, username);

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await request(app.getHttpServer())
          .post('/auth/login')
          .send({ identifier: email, password: 'Wr0ngPassw0rd' })
          .expect(401);
      }

      const blocked = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: email, password: PASSWORD })
        .expect(429);

      expect(blocked.body.error.code).toBe(COMMON_ERROR_CODES.rateLimited);
    });
  });

  describe('profile', () => {
    it('updates and clears the own profile through /auth/me', async () => {
      const { email, username } = uniqueIdentity('profile');
      await registerAndVerify(email, username);

      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: email, password: PASSWORD })
        .expect(200);
      const accessToken = loginResponse.body.data.accessToken as string;

      const updated = await request(app.getHttpServer())
        .patch('/auth/me')
        .set(bearer(accessToken))
        .send({ firstName: 'Jane', lastName: 'Doe', phone: '+4915112345678' })
        .expect(200);
      expect(updated.body.data).toMatchObject({
        email,
        username,
        firstName: 'Jane',
        lastName: 'Doe',
        phone: '+4915112345678',
      });

      // Blank strings clear nullable fields instead of storing whitespace.
      const cleared = await request(app.getHttpServer())
        .patch('/auth/me')
        .set(bearer(accessToken))
        .send({ firstName: '   ', phone: null })
        .expect(200);
      expect(cleared.body.data.firstName).toBeNull();
      expect(cleared.body.data.phone).toBeNull();
      expect(cleared.body.data.lastName).toBe('Doe');

      // Self-service reads (login/me) see the same stored profile.
      const relogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: username, password: PASSWORD })
        .expect(200);
      expect(relogin.body.data.user.firstName).toBeNull();
      expect(relogin.body.data.user.lastName).toBe('Doe');
    });

    it('rejects unauthenticated and invalid profile payloads', async () => {
      await request(app.getHttpServer())
        .patch('/auth/me')
        .send({ firstName: 'No' })
        .expect(401);

      const { email, username } = uniqueIdentity('badprofile');
      await registerAndVerify(email, username);

      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: email, password: PASSWORD })
        .expect(200);
      const accessToken = loginResponse.body.data.accessToken as string;

      const invalid = await request(app.getHttpServer())
        .patch('/auth/me')
        .set(bearer(accessToken))
        .send({ phone: 'not-a-phone' })
        .expect(400);

      expect(invalid.body.error.code).toBe(COMMON_ERROR_CODES.validationFailed);
    });
  });

  describe('sessions', () => {
    /** Logs in twice (two devices) and returns both token pairs plus agents. */
    async function loginTwoDevices(email: string): Promise<{
      first: { token: string; agent: ReturnType<typeof request.agent> };
      second: { token: string; agent: ReturnType<typeof request.agent> };
    }> {
      const firstAgent = request.agent(app.getHttpServer());
      const firstLogin = await firstAgent
        .post('/auth/login')
        .send({ identifier: email, password: PASSWORD })
        .expect(200);

      const secondAgent = request.agent(app.getHttpServer());
      const secondLogin = await secondAgent
        .post('/auth/login')
        .send({ identifier: email, password: PASSWORD })
        .expect(200);

      return {
        first: {
          token: firstLogin.body.data.accessToken as string,
          agent: firstAgent,
        },
        second: {
          token: secondLogin.body.data.accessToken as string,
          agent: secondAgent,
        },
      };
    }

    it('lists active sessions and marks the caller', async () => {
      const { email, username } = uniqueIdentity('sessions');
      await registerAndVerify(email, username);
      const { first } = await loginTwoDevices(email);

      const response = await request(app.getHttpServer())
        .get('/auth/sessions')
        .set(bearer(first.token))
        .expect(200);

      const sessions = response.body.data.sessions as Array<{
        id: string;
        current: boolean;
        lastUsedAt: string;
      }>;
      expect(sessions).toHaveLength(2);
      expect(sessions.filter((session) => session.current)).toHaveLength(1);
      expect(sessions[0].lastUsedAt).toEqual(expect.any(String));
    });

    it('logs out other devices while keeping the caller signed in', async () => {
      const { email, username } = uniqueIdentity('logoutothers');
      await registerAndVerify(email, username);
      const { first, second } = await loginTwoDevices(email);

      const response = await request(app.getHttpServer())
        .post('/auth/logout/others')
        .set(bearer(first.token))
        .expect(200);
      expect(response.body.data.message).toContain('other devices');

      // The caller keeps working…
      await request(app.getHttpServer())
        .get('/auth/me')
        .set(bearer(first.token))
        .expect(200);
      await first.agent.post('/auth/refresh').expect(200);

      // …the other device loses both tokens immediately.
      const revoked = await request(app.getHttpServer())
        .get('/auth/me')
        .set(bearer(second.token))
        .expect(401);
      expect(revoked.body.error.code).toBe(TOKEN_ERRORS.tokenRevoked);
      await second.agent.post('/auth/refresh').expect(401);

      const sessions = await request(app.getHttpServer())
        .get('/auth/sessions')
        .set(bearer(first.token))
        .expect(200);
      expect(sessions.body.data.sessions).toHaveLength(1);
    });

    it('revokes one session by id and reports unknown ids', async () => {
      const { email, username } = uniqueIdentity('revokeone');
      await registerAndVerify(email, username);
      const { first, second } = await loginTwoDevices(email);

      const list = await request(app.getHttpServer())
        .get('/auth/sessions')
        .set(bearer(first.token))
        .expect(200);
      const other = (
        list.body.data.sessions as Array<{ id: string; current: boolean }>
      ).find((session) => !session.current);

      expect(other).toBeDefined();

      await request(app.getHttpServer())
        .delete(`/auth/sessions/${other?.id}`)
        .set(bearer(first.token))
        .expect(200);

      const revoked = await request(app.getHttpServer())
        .get('/auth/me')
        .set(bearer(second.token))
        .expect(401);
      expect(revoked.body.error.code).toBe(TOKEN_ERRORS.tokenRevoked);
      await second.agent.post('/auth/refresh').expect(401);

      // Still signed in on the caller's device.
      await request(app.getHttpServer())
        .get('/auth/me')
        .set(bearer(first.token))
        .expect(200);

      const missing = await request(app.getHttpServer())
        .delete(`/auth/sessions/${other?.id}`)
        .set(bearer(first.token))
        .expect(404);
      expect(missing.body.error.code).toBe(TOKEN_ERRORS.sessionNotFound);
    });

    it('logs out the current device with only the refresh cookie', async () => {
      const { email, username } = uniqueIdentity('logoutcookie');
      await registerAndVerify(email, username);

      await request(app.getHttpServer())
        .post('/auth/logout/current')
        .expect(401);

      const agent = request.agent(app.getHttpServer());
      const login = await agent
        .post('/auth/login')
        .send({ identifier: email, password: PASSWORD })
        .expect(200);
      const accessToken = login.body.data.accessToken as string;

      // No Authorization header: the `/auth`-scoped cookie alone authorizes it.
      await agent.post('/auth/logout/current').expect(200);
      await agent.post('/auth/refresh').expect(401);

      const dead = await request(app.getHttpServer())
        .get('/auth/me')
        .set(bearer(accessToken))
        .expect(401);
      expect(dead.body.error.code).toBe(TOKEN_ERRORS.tokenRevoked);
    });

    it('logs out the current device only and denylists its access token', async () => {
      const { email, username } = uniqueIdentity('logoutcurrent');
      await registerAndVerify(email, username);
      const { first, second } = await loginTwoDevices(email);

      await first.agent
        .post('/auth/logout/current')
        .set(bearer(first.token))
        .expect(200);

      const dead = await request(app.getHttpServer())
        .get('/auth/me')
        .set(bearer(first.token))
        .expect(401);
      expect(dead.body.error.code).toBe(TOKEN_ERRORS.tokenRevoked);
      await first.agent.post('/auth/refresh').expect(401);

      await request(app.getHttpServer())
        .get('/auth/me')
        .set(bearer(second.token))
        .expect(200);
    });
  });

  describe('account deletion', () => {
    it('soft-deletes the own account, frees the identifiers and blocks login', async () => {
      const { email, username } = uniqueIdentity('selfdelete');
      await registerAndVerify(email, username);

      const agent = request.agent(app.getHttpServer());
      const loginResponse = await agent
        .post('/auth/login')
        .send({ identifier: email, password: PASSWORD })
        .expect(200);
      const accessToken = loginResponse.body.data.accessToken as string;

      const wrongPassword = await request(app.getHttpServer())
        .post('/auth/delete-account')
        .set(bearer(accessToken))
        .send({ password: 'Wr0ngPassw', confirm: true })
        .expect(400);
      expect(wrongPassword.body.error.code).toBe(
        AUTH_ERRORS.invalidCurrentPassword,
      );

      await request(app.getHttpServer())
        .post('/auth/delete-account')
        .set(bearer(accessToken))
        .send({ password: PASSWORD, confirm: false })
        .expect(400);

      await agent
        .post('/auth/delete-account')
        .set(bearer(accessToken))
        .send({ password: PASSWORD, confirm: true })
        .expect(200);

      // The account is soft-deleted: no access, no refresh, no login.
      // Deletion also stamps the revocation watermark, so the token is
      // rejected as revoked rather than merely unknown.
      const dead = await request(app.getHttpServer())
        .get('/auth/me')
        .set(bearer(accessToken))
        .expect(401);
      expect(dead.body.error.code).toBe(TOKEN_ERRORS.tokenRevoked);
      await agent.post('/auth/refresh').expect(401);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: email, password: PASSWORD })
        .expect(401);

      // The row survives for a restore…
      const rows = (await dataSource.query(
        'SELECT "deletedAt" FROM users WHERE email = $1',
        [email],
      )) as Array<{ deletedAt: Date | null }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].deletedAt).not.toBeNull();

      // …while the identifiers are immediately reusable.
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email,
          username,
          password: NEW_PASSWORD,
          passwordConfirm: NEW_PASSWORD,
        })
        .expect(201);
    });
  });

  describe('email change', () => {
    it('rejects unauthenticated, wrong-password, unchanged and taken addresses', async () => {
      const { email, username } = uniqueIdentity('emailbad');
      await registerAndVerify(email, username);

      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: email, password: PASSWORD })
        .expect(200);
      const token = login.body.data.accessToken as string;

      await request(app.getHttpServer())
        .post('/auth/email')
        .send({ email: 'new@example.com', password: PASSWORD })
        .expect(401);

      const wrongPassword = await request(app.getHttpServer())
        .post('/auth/email')
        .set(bearer(token))
        .send({ email: 'new@example.com', password: 'Wr0ngPassw' })
        .expect(400);
      expect(wrongPassword.body.error.code).toBe(
        AUTH_ERRORS.invalidCurrentPassword,
      );

      const unchanged = await request(app.getHttpServer())
        .post('/auth/email')
        .set(bearer(token))
        .send({ email: ` ${email.toUpperCase()} `, password: PASSWORD })
        .expect(400);
      expect(unchanged.body.error.code).toBe(USER_ERRORS.emailUnchanged);

      // Belongs to another active account (registered, not necessarily verified).
      const other = uniqueIdentity('emailtaken');
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: other.email,
          username: other.username,
          password: PASSWORD,
          passwordConfirm: PASSWORD,
        })
        .expect(201);

      const taken = await request(app.getHttpServer())
        .post('/auth/email')
        .set(bearer(token))
        .send({ email: other.email, password: PASSWORD })
        .expect(409);
      expect(taken.body.error.code).toBe(USER_ERRORS.emailTaken);
    });

    it('changes a verified address only after approval from the old address', async () => {
      const { email, username } = uniqueIdentity('emailold');
      await registerAndVerify(email, username);
      const replacement = uniqueIdentity('emailnew');

      const agent = request.agent(app.getHttpServer());
      const login = await agent
        .post('/auth/login')
        .send({ identifier: email, password: PASSWORD })
        .expect(200);
      const accessToken = login.body.data.accessToken as string;

      const requested = await request(app.getHttpServer())
        .post('/auth/email')
        .set(bearer(accessToken))
        .send({ email: replacement.email, password: PASSWORD })
        .expect(200);
      expect(requested.body.data.message).toContain('current address');

      // Nothing changed; the session still works while approval is pending.
      const stillOld = await request(app.getHttpServer())
        .get('/auth/me')
        .set(bearer(accessToken))
        .expect(200);
      expect(stillOld.body.data.email).toBe(email);

      // Pending visibility without changing the `/auth/me` shape.
      const pending = await request(app.getHttpServer())
        .get('/auth/email')
        .set(bearer(accessToken))
        .expect(200);
      expect(pending.body.data).toMatchObject({
        newEmail: replacement.email,
      });

      const approval = await findLatestEmail(email);
      expect(approval.subject).toBe('Approve your email change');
      expect(approval.text).toContain(replacement.email);
      const approvalToken = extractToken(approval.text);

      // Cancelling invalidates the pending link and clears visibility.
      const cancelled = await request(app.getHttpServer())
        .delete('/auth/email')
        .set(bearer(accessToken))
        .expect(200);
      expect(cancelled.body.data.message).toContain('cancelled');

      const noPending = await request(app.getHttpServer())
        .get('/auth/email')
        .set(bearer(accessToken))
        .expect(200);
      expect(noPending.body.data).toBeNull();

      const staleLink = await request(app.getHttpServer())
        .get('/auth/email/approve')
        .query({ token: approvalToken })
        .expect(400);
      expect(staleLink.body.error.code).toBe(TOKEN_ERRORS.invalidToken);

      // A fresh request produces a new link that previews harmlessly and
      // completes the change only on POST.
      await request(app.getHttpServer())
        .post('/auth/email')
        .set(bearer(accessToken))
        .send({ email: replacement.email, password: PASSWORD })
        .expect(200);
      const freshApproval = await findLatestEmail(email);
      const freshToken = extractToken(freshApproval.text);

      const preview = await request(app.getHttpServer())
        .get('/auth/email/approve')
        .query({ token: freshToken })
        .expect(200);
      expect(preview.body.data.newEmail).toBe(replacement.email);

      // The preview did not mutate anything: the old address still works.
      const stillPending = await request(app.getHttpServer())
        .get('/auth/me')
        .set(bearer(accessToken))
        .expect(200);
      expect(stillPending.body.data.email).toBe(email);

      await request(app.getHttpServer())
        .post('/auth/email/approve')
        .send({ token: freshToken })
        .expect(200);

      // Approval swaps the address unverified and revokes every session.
      const dead = await request(app.getHttpServer())
        .get('/auth/me')
        .set(bearer(accessToken))
        .expect(401);
      expect(dead.body.error.code).toBe(TOKEN_ERRORS.tokenRevoked);
      await agent.post('/auth/refresh').expect(401);

      const reused = await request(app.getHttpServer())
        .post('/auth/email/approve')
        .send({ token: freshToken })
        .expect(400);
      expect(reused.body.error.code).toBe(TOKEN_ERRORS.invalidToken);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: email, password: PASSWORD })
        .expect(401);

      const unverifiedLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: replacement.email, password: PASSWORD })
        .expect(403);
      expect(unverifiedLogin.body.error.code).toBe(
        AUTH_ERRORS.emailNotVerified,
      );

      const verification = await findLatestEmail(replacement.email);
      expect(verification.subject).toBe('Verify your email');
      await request(app.getHttpServer())
        .get('/auth/verify-email')
        .query({ token: extractToken(verification.text) })
        .expect(200);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: replacement.email, password: PASSWORD })
        .expect(200);
    });

    it('cancels a pending change when the password changes', async () => {
      const { email, username } = uniqueIdentity('emailpwd');
      await registerAndVerify(email, username);
      const replacement = uniqueIdentity('emailpwdnew');

      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: email, password: PASSWORD })
        .expect(200);
      const accessToken = login.body.data.accessToken as string;

      await request(app.getHttpServer())
        .post('/auth/email')
        .set(bearer(accessToken))
        .send({ email: replacement.email, password: PASSWORD })
        .expect(200);
      const approval = await findLatestEmail(email);
      const approvalToken = extractToken(approval.text);

      await request(app.getHttpServer())
        .patch('/auth/password')
        .set(bearer(accessToken))
        .send({
          currentPassword: PASSWORD,
          newPassword: NEW_PASSWORD,
          passwordConfirm: NEW_PASSWORD,
        })
        .expect(200);

      // The approval link was requested with credentials that no longer exist.
      const stale = await request(app.getHttpServer())
        .post('/auth/email/approve')
        .send({ token: approvalToken })
        .expect(400);
      expect(stale.body.error.code).toBe(TOKEN_ERRORS.invalidToken);

      const relogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: email, password: NEW_PASSWORD })
        .expect(200);

      const pending = await request(app.getHttpServer())
        .get('/auth/email')
        .set(bearer(relogin.body.data.accessToken as string))
        .expect(200);
      expect(pending.body.data).toBeNull();
    });

    it('invalidates outstanding password-reset links when the email changes', async () => {
      const { email, username } = uniqueIdentity('emailreset');
      await registerAndVerify(email, username);
      const replacement = uniqueIdentity('emailresetnew');

      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: email, password: PASSWORD })
        .expect(200);
      const accessToken = login.body.data.accessToken as string;

      await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ identifier: email })
        .expect(200);
      const resetEmail = await findLatestEmail(email);
      expect(resetEmail.subject).toBe('Reset your password');
      const resetToken = extractToken(resetEmail.text);

      await request(app.getHttpServer())
        .post('/auth/email')
        .set(bearer(accessToken))
        .send({ email: replacement.email, password: PASSWORD })
        .expect(200);
      const approval = await findLatestEmail(email);
      expect(approval.subject).toBe('Approve your email change');

      await request(app.getHttpServer())
        .post('/auth/email/approve')
        .send({ token: extractToken(approval.text) })
        .expect(200);

      // The reset link belonged to the mailbox that no longer owns the account.
      const staleReset = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({
          token: resetToken,
          newPassword: NEW_PASSWORD,
          passwordConfirm: NEW_PASSWORD,
        })
        .expect(400);
      expect(staleReset.body.error.code).toBe(TOKEN_ERRORS.invalidToken);
    });

    it('changes an unverified address immediately', async () => {
      const { email, username } = uniqueIdentity('emailquick');
      await registerAndVerify(email, username);
      const replacement = uniqueIdentity('emailquicknew');

      const agent = request.agent(app.getHttpServer());
      const login = await agent
        .post('/auth/login')
        .send({ identifier: email, password: PASSWORD })
        .expect(200);
      const accessToken = login.body.data.accessToken as string;

      // An unverified session can only exist if verification was invalidated
      // after login (setup-only state manipulation selects that branch).
      await dataSource.query(
        'UPDATE "users" SET "emailVerifiedAt" = NULL WHERE "email" = $1',
        [email],
      );

      const response = await request(app.getHttpServer())
        .post('/auth/email')
        .set(bearer(accessToken))
        .send({ email: replacement.email, password: PASSWORD })
        .expect(200);
      expect(response.body.data.message).toContain('Verify your new address');

      // The change is immediate: sessions die and the old address is gone.
      const dead = await request(app.getHttpServer())
        .get('/auth/me')
        .set(bearer(accessToken))
        .expect(401);
      expect(dead.body.error.code).toBe(TOKEN_ERRORS.tokenRevoked);
      await agent.post('/auth/refresh').expect(401);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: email, password: PASSWORD })
        .expect(401);

      const verification = await findLatestEmail(replacement.email);
      expect(verification.subject).toBe('Verify your email');
      await request(app.getHttpServer())
        .get('/auth/verify-email')
        .query({ token: extractToken(verification.text) })
        .expect(200);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: replacement.email, password: PASSWORD })
        .expect(200);
    });
  });

  describe('password flows', () => {
    it('changes the password while logged in and forces a fresh login everywhere', async () => {
      const { email, username } = uniqueIdentity('change');
      await registerAndVerify(email, username);

      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: email, password: PASSWORD })
        .expect(200);
      const accessToken = loginResponse.body.data.accessToken as string;

      await request(app.getHttpServer())
        .patch('/auth/password')
        .set(bearer(accessToken))
        .send({
          currentPassword: 'Wr0ngCurr3nt',
          newPassword: NEW_PASSWORD,
          passwordConfirm: NEW_PASSWORD,
        })
        .expect(400);

      await request(app.getHttpServer())
        .patch('/auth/password')
        .set(bearer(accessToken))
        .send({
          currentPassword: PASSWORD,
          newPassword: NEW_PASSWORD,
          passwordConfirm: NEW_PASSWORD,
        })
        .expect(200);

      // Even the token used for the change is revoked now.
      await request(app.getHttpServer())
        .get('/auth/me')
        .set(bearer(accessToken))
        .expect(401);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: email, password: PASSWORD })
        .expect(401);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: email, password: NEW_PASSWORD })
        .expect(200);
    });

    it('resets a forgotten password via the emailed link', async () => {
      const { email, username } = uniqueIdentity('reset');
      await registerAndVerify(email, username);

      const agent = request.agent(app.getHttpServer());
      await agent
        .post('/auth/login')
        .send({ identifier: email, password: PASSWORD })
        .expect(200);

      const forgot = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ identifier: email })
        .expect(200);
      expect(forgot.body.data.message).toContain('If an account exists');

      const message = await findLatestEmail(email);
      expect(message.subject).toBe('Reset your password');

      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({
          token: extractToken(message.text),
          newPassword: NEW_PASSWORD,
          passwordConfirm: NEW_PASSWORD,
        })
        .expect(200);

      // Every session is revoked and only the new password works.
      await agent.post('/auth/refresh').expect(401);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: email, password: PASSWORD })
        .expect(401);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: username, password: NEW_PASSWORD })
        .expect(200);
    });

    it('consumes a reset token only once under concurrent requests', async () => {
      const { email, username } = uniqueIdentity('resetrace');
      await registerAndVerify(email, username);

      await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ identifier: email })
        .expect(200);
      const message = await findLatestEmail(email);
      const token = extractToken(message.text);

      const attempts = await Promise.all([
        request(app.getHttpServer()).post('/auth/reset-password').send({
          token,
          newPassword: NEW_PASSWORD,
          passwordConfirm: NEW_PASSWORD,
        }),
        request(app.getHttpServer()).post('/auth/reset-password').send({
          token,
          newPassword: NEW_PASSWORD,
          passwordConfirm: NEW_PASSWORD,
        }),
      ]);

      expect(
        attempts.map((attempt) => attempt.status).sort((a, b) => a - b),
      ).toEqual([200, 400]);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: email, password: PASSWORD })
        .expect(401);
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: email, password: NEW_PASSWORD })
        .expect(200);
    });

    it('answers forgot-password generically for unknown accounts', async () => {
      const { email } = uniqueIdentity('ghost');

      const response = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ identifier: email })
        .expect(200);

      expect(response.body.data.message).toContain('If an account exists');
    });
  });
});
