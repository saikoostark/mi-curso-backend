import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { ADMIN_USER_ERRORS } from '../src/admin/users/users.error-codes.js';
import { COMMON_ERROR_CODES } from '../src/common/http/error-codes.js';
import { AUTH_ERRORS } from '../src/identity/auth/auth.error-codes.js';
import { PASSWORD_ERRORS } from '../src/identity/password/password.error-codes.js';
import { USER_ERRORS } from '../src/identity/users/users.error-codes.js';
import { createE2eApp } from './setup/app.js';
import {
  bearer,
  loginForToken,
  seedVerifiedUser,
  truncateForAuthorization,
} from './setup/authorization.js';
import { readOutbox, extractToken, findLatestEmail } from './setup/outbox.js';
import { clearAuthKeys } from './setup/redis.js';

const PASSWORD = 'Str0ngPassw';

describe('Users admin (e2e)', () => {
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
    await truncateForAuthorization(dataSource);
    await clearAuthKeys();
  });

  /** Unique email/username pair per call. */
  function uniqueIdentity(prefix: string): {
    email: string;
    username: string;
  } {
    counter += 1;
    // Base-36 keeps usernames under the 30-character policy for long prefixes.
    const tag = `${prefix}-${Date.now().toString(36)}-${counter}`;
    return {
      email: `${tag}@example.com`,
      username: `u_${tag.replace(/-/g, '_')}`,
    };
  }

  /** Seeds a verified superuser and returns its access token. */
  async function superuserToken(): Promise<string> {
    const identity = uniqueIdentity('root');
    await seedVerifiedUser(dataSource, {
      ...identity,
      password: PASSWORD,
      isSuperuser: true,
    });

    return loginForToken(app, identity.email, PASSWORD);
  }

  /** Creates a user through the admin API and returns the profile. */
  async function createViaApi(
    token: string,
    identity: { email: string; username: string },
    extra: Record<string, unknown> = {},
  ): Promise<Record<string, unknown> & { id: string }> {
    const response = await request(app.getHttpServer())
      .post('/users')
      .set(bearer(token))
      .send({
        email: identity.email,
        username: identity.username,
        password: PASSWORD,
        passwordConfirm: PASSWORD,
        ...extra,
      })
      .expect(201);

    return response.body.data as Record<string, unknown> & { id: string };
  }

  it('creates verified accounts without an email flow', async () => {
    const token = await superuserToken();
    const identity = uniqueIdentity('created');

    const profile = await createViaApi(token, identity, { firstName: 'New' });

    expect(profile).toMatchObject({
      email: identity.email,
      username: identity.username,
      firstName: 'New',
      emailVerified: true,
      isSuperuser: false,
    });

    // The password works immediately and the account is already verified...
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ identifier: identity.email, password: PASSWORD })
      .expect(200);

    // ...because no verification email was ever sent for it.
    const emails = await readOutbox();
    expect(emails.filter((email) => email.to === identity.email)).toHaveLength(
      0,
    );
  });

  it('validates creation payloads', async () => {
    const token = await superuserToken();
    const identity = uniqueIdentity('dupe');
    const other = uniqueIdentity('other');
    await createViaApi(token, identity);

    const duplicateEmail = await request(app.getHttpServer())
      .post('/users')
      .set(bearer(token))
      .send({
        email: identity.email,
        username: other.username,
        password: PASSWORD,
        passwordConfirm: PASSWORD,
      })
      .expect(409);
    expect(duplicateEmail.body.error.code).toBe(USER_ERRORS.emailTaken);

    const duplicateUsername = await request(app.getHttpServer())
      .post('/users')
      .set(bearer(token))
      .send({
        email: other.email,
        username: identity.username,
        password: PASSWORD,
        passwordConfirm: PASSWORD,
      })
      .expect(409);
    expect(duplicateUsername.body.error.code).toBe(USER_ERRORS.usernameTaken);

    const mismatch = await request(app.getHttpServer())
      .post('/users')
      .set(bearer(token))
      .send({
        email: other.email,
        username: other.username,
        password: PASSWORD,
        passwordConfirm: `${PASSWORD}x`,
      })
      .expect(400);
    expect(mismatch.body.error.code).toBe(PASSWORD_ERRORS.passwordMismatch);

    const weak = await request(app.getHttpServer())
      .post('/users')
      .set(bearer(token))
      .send({
        email: other.email,
        username: other.username,
        password: 'lowercaseonly',
        passwordConfirm: 'lowercaseonly',
      })
      .expect(400);
    expect(weak.body.error.code).toBe(PASSWORD_ERRORS.passwordPolicy);

    const injected = await request(app.getHttpServer())
      .post('/users')
      .set(bearer(token))
      .send({
        email: other.email,
        username: other.username,
        password: PASSWORD,
        passwordConfirm: PASSWORD,
        isSuperuser: true,
      })
      .expect(400);
    expect(injected.body.error.code).toBe(COMMON_ERROR_CODES.validationFailed);
    expect(JSON.stringify(injected.body.error.details)).toContain(
      'isSuperuser',
    );
  });

  it('lists, pages and reads users', async () => {
    const token = await superuserToken();
    const identities = [
      uniqueIdentity('page1'),
      uniqueIdentity('page2'),
      uniqueIdentity('page3'),
    ];
    for (const identity of identities) {
      await createViaApi(token, identity);
    }

    const firstPage = await request(app.getHttpServer())
      .get('/users')
      .query({ page: 1, limit: 2 })
      .set(bearer(token))
      .expect(200);
    expect(firstPage.body.success).toBe(true);
    expect(firstPage.body.data.pagination).toEqual({
      page: 1,
      limit: 2,
      total: 4,
      totalPages: 2,
      hasNext: true,
      hasPrevious: false,
    });
    expect(firstPage.body.data.page).toHaveLength(2);
    expect(firstPage.body.data.page[0]).not.toHaveProperty('passwordHash');

    const secondPage = await request(app.getHttpServer())
      .get('/users')
      .query({ page: 2, limit: 2 })
      .set(bearer(token))
      .expect(200);
    expect(secondPage.body.data.page).toHaveLength(2);
    expect(secondPage.body.data.pagination).toMatchObject({
      page: 2,
      hasNext: false,
      hasPrevious: true,
    });

    const listedEmails = [
      ...firstPage.body.data.page,
      ...secondPage.body.data.page,
    ].map((item: { email: string }) => item.email);
    expect(listedEmails).toEqual(
      expect.arrayContaining(identities.map((identity) => identity.email)),
    );

    // Ties on `createdAt` are broken by id, so repeating the query is stable.
    const repeated = await request(app.getHttpServer())
      .get('/users')
      .query({ page: 1, limit: 2 })
      .set(bearer(token))
      .expect(200);
    expect(
      repeated.body.data.page.map((item: { id: string }) => item.id),
    ).toEqual(firstPage.body.data.page.map((item: { id: string }) => item.id));

    const single = await request(app.getHttpServer())
      .get(`/users/${firstPage.body.data.page[0].id}`)
      .set(bearer(token))
      .expect(200);
    expect(single.body.data.id).toBe(firstPage.body.data.page[0].id);
    expect(single.body.data).not.toHaveProperty('passwordHash');

    const missing = await request(app.getHttpServer())
      .get(`/users/${randomUUID()}`)
      .set(bearer(token))
      .expect(404);
    expect(missing.body.error.code).toBe(USER_ERRORS.userNotFound);

    await request(app.getHttpServer())
      .get('/users/not-a-uuid')
      .set(bearer(token))
      .expect(400);
  });

  it('filters and sorts the user list', async () => {
    const root = uniqueIdentity('filterroot');
    await seedVerifiedUser(dataSource, {
      ...root,
      password: PASSWORD,
      isSuperuser: true,
    });
    const token = await loginForToken(app, root.email, PASSWORD);

    const alice = uniqueIdentity('alice');
    const bob = uniqueIdentity('bob');
    await createViaApi(token, alice, {
      firstName: 'Alice',
      lastName: 'Smith',
    });
    await createViaApi(token, bob, { firstName: 'Bob', lastName: 'Jones' });

    // Unverified users only exist through self-registration.
    const carol = uniqueIdentity('carol');
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: carol.email,
        username: carol.username,
        password: PASSWORD,
        passwordConfirm: PASSWORD,
      })
      .expect(201);

    // Case-insensitive partial match across email, username and names.
    const byName = await request(app.getHttpServer())
      .get('/users')
      .query({ search: 'ALI' })
      .set(bearer(token))
      .expect(200);
    expect(
      byName.body.data.page.map((user: { email: string }) => user.email),
    ).toEqual([alice.email]);

    const byUsername = await request(app.getHttpServer())
      .get('/users')
      .query({ search: 'bob' })
      .set(bearer(token))
      .expect(200);
    expect(
      byUsername.body.data.page.map((user: { email: string }) => user.email),
    ).toEqual([bob.email]);

    // A blank search is ignored rather than matching everything explicitly.
    const blank = await request(app.getHttpServer())
      .get('/users')
      .query({ search: '   ' })
      .set(bearer(token))
      .expect(200);
    expect(blank.body.data.pagination.total).toBe(4);

    const unverified = await request(app.getHttpServer())
      .get('/users')
      .query({ emailVerified: 'false' })
      .set(bearer(token))
      .expect(200);
    expect(
      unverified.body.data.page.map((user: { email: string }) => user.email),
    ).toEqual([carol.email]);

    const superusers = await request(app.getHttpServer())
      .get('/users')
      .query({ isSuperuser: 'true' })
      .set(bearer(token))
      .expect(200);
    expect(
      superusers.body.data.page.map((user: { email: string }) => user.email),
    ).toEqual([root.email]);

    // Filters combine, and sorting is deterministic and whitelisted.
    const sorted = await request(app.getHttpServer())
      .get('/users')
      .query({
        emailVerified: 'true',
        isSuperuser: 'false',
        sort: 'email',
        order: 'asc',
        limit: 100,
      })
      .set(bearer(token))
      .expect(200);
    expect(
      sorted.body.data.page.map((user: { email: string }) => user.email),
    ).toEqual([alice.email, bob.email]);

    for (const query of [
      { sort: 'passwordHash' },
      { order: 'sideways' },
      { emailVerified: 'maybe' },
      { isSuperuser: 'yes' },
    ]) {
      await request(app.getHttpServer())
        .get('/users')
        .query(query)
        .set(bearer(token))
        .expect(400);
    }
  });

  it('updates profiles and enforces uniqueness', async () => {
    const token = await superuserToken();
    const identity = uniqueIdentity('update');
    const other = uniqueIdentity('conflict');
    const profile = await createViaApi(token, identity);
    await createViaApi(token, other);

    const updated = await request(app.getHttpServer())
      .patch(`/users/${profile.id}`)
      .set(bearer(token))
      .send({
        firstName: 'Jane',
        lastName: 'Doe',
        phone: '+4915112345678',
      })
      .expect(200);
    expect(updated.body.data).toMatchObject({
      firstName: 'Jane',
      lastName: 'Doe',
      phone: '+4915112345678',
      email: identity.email,
      username: identity.username,
    });

    const emailClash = await request(app.getHttpServer())
      .patch(`/users/${profile.id}`)
      .set(bearer(token))
      .send({ email: other.email })
      .expect(409);
    expect(emailClash.body.error.code).toBe(USER_ERRORS.emailTaken);

    const usernameClash = await request(app.getHttpServer())
      .patch(`/users/${profile.id}`)
      .set(bearer(token))
      .send({ username: other.username })
      .expect(409);
    expect(usernameClash.body.error.code).toBe(USER_ERRORS.usernameTaken);

    // Keeping your own email/username is fine.
    await request(app.getHttpServer())
      .patch(`/users/${profile.id}`)
      .set(bearer(token))
      .send({ email: identity.email, username: identity.username })
      .expect(200);

    // Account identifiers cannot be cleared...
    await request(app.getHttpServer())
      .patch(`/users/${profile.id}`)
      .set(bearer(token))
      .send({ email: null })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/users/${profile.id}`)
      .set(bearer(token))
      .send({ username: null })
      .expect(400);

    // ...while nullable profile fields can.
    const cleared = await request(app.getHttpServer())
      .patch(`/users/${profile.id}`)
      .set(bearer(token))
      .send({ phone: null })
      .expect(200);
    expect(cleared.body.data.phone).toBeNull();

    await request(app.getHttpServer())
      .patch(`/users/${randomUUID()}`)
      .set(bearer(token))
      .send({ firstName: 'Ghost' })
      .expect(404);

    await request(app.getHttpServer())
      .patch('/users/not-a-uuid')
      .set(bearer(token))
      .send({ firstName: 'Ghost' })
      .expect(400);
  });

  it('stores account and profile data separately without clobbering each other', async () => {
    const token = await superuserToken();
    const identity = uniqueIdentity('split');
    const profile = await createViaApi(token, identity, {
      firstName: 'Jane',
      lastName: 'Doe',
      phone: '+4915112345678',
    });

    // The profile fields landed in their own table...
    const storedProfile = await dataSource.query<
      { firstName: string; lastName: string; phone: string }[]
    >(
      'SELECT "firstName", "lastName", "phone" FROM "user_profiles" WHERE "userId" = $1',
      [profile.id],
    );
    expect(storedProfile[0]).toEqual({
      firstName: 'Jane',
      lastName: 'Doe',
      phone: '+4915112345678',
    });

    // ...an account-only update leaves them untouched...
    const newEmail = `moved-${Date.now()}@example.com`;
    const accountUpdate = await request(app.getHttpServer())
      .patch(`/users/${profile.id}`)
      .set(bearer(token))
      .send({ email: newEmail })
      .expect(200);
    expect(accountUpdate.body.data).toMatchObject({
      email: newEmail,
      username: identity.username,
      firstName: 'Jane',
      lastName: 'Doe',
      phone: '+4915112345678',
    });

    // ...and a profile-only update leaves the account fields untouched.
    const profileUpdate = await request(app.getHttpServer())
      .patch(`/users/${profile.id}`)
      .set(bearer(token))
      .send({ firstName: 'Janet' })
      .expect(200);
    expect(profileUpdate.body.data).toMatchObject({
      email: newEmail,
      username: identity.username,
      firstName: 'Janet',
    });

    const storedUser = await dataSource.query<{ email: string }[]>(
      'SELECT "email" FROM "users" WHERE "id" = $1',
      [profile.id],
    );
    expect(storedUser[0].email).toBe(newEmail);
  });

  it('deletes users but never yourself', async () => {
    const root = uniqueIdentity('root');
    const rootId = await seedVerifiedUser(dataSource, {
      ...root,
      password: PASSWORD,
      isSuperuser: true,
    });
    const token = await loginForToken(app, root.email, PASSWORD);

    const identity = uniqueIdentity('removable');
    const profile = await createViaApi(token, identity);

    await request(app.getHttpServer())
      .delete(`/users/${profile.id}`)
      .set(bearer(token))
      .expect(200);

    await request(app.getHttpServer())
      .get(`/users/${profile.id}`)
      .set(bearer(token))
      .expect(404);

    const self = await request(app.getHttpServer())
      .delete(`/users/${rootId}`)
      .set(bearer(token))
      .expect(400);
    expect(self.body.error.code).toBe(ADMIN_USER_ERRORS.cannotDeleteSelf);

    await request(app.getHttpServer())
      .delete(`/users/${randomUUID()}`)
      .set(bearer(token))
      .expect(404);
  });

  it('soft-deletes accounts, releases identifiers and restores them unchanged', async () => {
    const token = await superuserToken();
    const identity = uniqueIdentity('soft');
    const profile = await createViaApi(token, identity, { firstName: 'Sam' });

    // The victim is signed in before the deletion, so the spec can prove the
    // sessions die with the account.
    const agent = request.agent(app.getHttpServer());
    const login = await agent
      .post('/auth/login')
      .send({ identifier: identity.email, password: PASSWORD })
      .expect(200);
    const victimToken = login.body.data.accessToken as string;

    await request(app.getHttpServer())
      .delete(`/users/${profile.id}`)
      .set(bearer(token))
      .expect(200);

    // Hidden from default admin reads and the active list, but the row
    // survives and is reachable explicitly.
    await request(app.getHttpServer())
      .get(`/users/${profile.id}`)
      .set(bearer(token))
      .expect(404);

    const deletedDetail = await request(app.getHttpServer())
      .get(`/users/${profile.id}`)
      .query({ withDeleted: true })
      .set(bearer(token))
      .expect(200);
    expect(deletedDetail.body.data.deletedAt).not.toBeNull();

    const list = await request(app.getHttpServer())
      .get('/users')
      .set(bearer(token))
      .expect(200);
    expect(list.body.data.pagination.total).toBe(1); // only the root

    const deletedList = await request(app.getHttpServer())
      .get('/users')
      .query({ status: 'deleted' })
      .set(bearer(token))
      .expect(200);
    expect(deletedList.body.data.pagination.total).toBe(1);
    expect(deletedList.body.data.page[0]).toMatchObject({
      id: profile.id,
      deletedAt: expect.any(String),
    });

    const allList = await request(app.getHttpServer())
      .get('/users')
      .query({ status: 'all' })
      .set(bearer(token))
      .expect(200);
    expect(allList.body.data.pagination.total).toBe(2);

    await request(app.getHttpServer())
      .get('/users')
      .query({ status: 'bogus' })
      .set(bearer(token))
      .expect(400);

    const stored = await dataSource.query<{ deletedAt: Date | null }[]>(
      'SELECT "deletedAt" FROM "users" WHERE "id" = $1',
      [profile.id],
    );
    expect(stored[0].deletedAt).not.toBeNull();

    // Sessions and pending tokens are destroyed immediately.
    const sessions = await dataSource.query<{ id: string }[]>(
      'SELECT "id" FROM "refresh_tokens" WHERE "userId" = $1',
      [profile.id],
    );
    expect(sessions).toHaveLength(0);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set(bearer(victimToken))
      .expect(401);
    await agent.post('/auth/refresh').expect(401);

    // Restore keeps the stored identifiers, profile and verified state, but
    // forces a fresh password before the account can log in again.
    const restored = await request(app.getHttpServer())
      .post(`/users/${profile.id}/restore`)
      .set(bearer(token))
      .send({})
      .expect(200);
    expect(restored.body.data).toMatchObject({
      id: profile.id,
      email: identity.email,
      username: identity.username,
      firstName: 'Sam',
      emailVerified: true,
      deletedAt: null,
    });

    const blocked = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ identifier: identity.email, password: PASSWORD })
      .expect(403);
    expect(blocked.body.error.code).toBe(AUTH_ERRORS.passwordResetRequired);

    const resetEmail = await findLatestEmail(identity.email);
    expect(resetEmail.subject).toBe('Reset your password');

    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({
        token: extractToken(resetEmail.text),
        newPassword: 'NewStr0ngPassw',
        passwordConfirm: 'NewStr0ngPassw',
      })
      .expect(200);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ identifier: identity.email, password: PASSWORD })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ identifier: identity.email, password: 'NewStr0ngPassw' })
      .expect(200);

    const active = await request(app.getHttpServer())
      .post(`/users/${profile.id}/restore`)
      .set(bearer(token))
      .send({})
      .expect(400);
    expect(active.body.error.code).toBe(ADMIN_USER_ERRORS.notDeleted);

    await request(app.getHttpServer())
      .post(`/users/${randomUUID()}/restore`)
      .set(bearer(token))
      .send({})
      .expect(404);
  });

  it('reports restore conflicts and accepts replacement identifiers', async () => {
    const token = await superuserToken();
    const identity = uniqueIdentity('rs');
    const profile = await createViaApi(token, identity);

    await request(app.getHttpServer())
      .delete(`/users/${profile.id}`)
      .set(bearer(token))
      .expect(200);

    // Deleted accounts release their identifiers: a fresh registration claims
    // them in the meantime.
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: identity.email,
        username: identity.username,
        password: PASSWORD,
        passwordConfirm: PASSWORD,
      })
      .expect(201);

    const conflict = await request(app.getHttpServer())
      .post(`/users/${profile.id}/restore`)
      .set(bearer(token))
      .send({})
      .expect(409);
    expect(conflict.body.error.code).toBe(USER_ERRORS.restoreConflict);
    expect(conflict.body.error.meta).toEqual({
      conflicts: ['email', 'username'],
    });

    // A single replacement leaves the other collision reported.
    const partial = await request(app.getHttpServer())
      .post(`/users/${profile.id}/restore`)
      .set(bearer(token))
      .send({ email: `partial-${Date.now()}@example.com` })
      .expect(409);
    expect(partial.body.error.meta).toEqual({ conflicts: ['username'] });

    // Replacing the email also clears verification and mails the new address.
    const replacement = uniqueIdentity('rsnew');
    const restored = await request(app.getHttpServer())
      .post(`/users/${profile.id}/restore`)
      .set(bearer(token))
      .send({ email: replacement.email, username: replacement.username })
      .expect(200);
    expect(restored.body.data).toMatchObject({
      id: profile.id,
      email: replacement.email,
      username: replacement.username,
      emailVerified: false,
    });

    const messages = (await readOutbox()).filter(
      (email) => email.to === replacement.email,
    );
    const verification = messages.find(
      (email) => email.subject === 'Verify your email',
    );
    const reset = messages.find(
      (email) => email.subject === 'Reset your password',
    );
    expect(verification).toBeDefined();
    expect(reset).toBeDefined();

    // The forced reset takes precedence over verification; the old password
    // is no longer accepted, and verification is still required afterwards.
    const blocked = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ identifier: replacement.email, password: PASSWORD })
      .expect(403);
    expect(blocked.body.error.code).toBe(AUTH_ERRORS.passwordResetRequired);

    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({
        token: extractToken(reset?.text ?? ''),
        newPassword: 'NewStr0ngPassw',
        passwordConfirm: 'NewStr0ngPassw',
      })
      .expect(200);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ identifier: replacement.email, password: PASSWORD })
      .expect(401);

    const unverified = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ identifier: replacement.email, password: 'NewStr0ngPassw' })
      .expect(403);
    expect(unverified.body.error.code).toBe(AUTH_ERRORS.emailNotVerified);

    await request(app.getHttpServer())
      .get('/auth/verify-email')
      .query({ token: extractToken(verification?.text ?? '') })
      .expect(200);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ identifier: replacement.email, password: 'NewStr0ngPassw' })
      .expect(200);
  });
});
