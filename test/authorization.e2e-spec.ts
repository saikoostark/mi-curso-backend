import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { ADMIN_USER_ERRORS } from '../src/admin/users/users.error-codes.js';
import { ATTRIBUTE_ERRORS } from '../src/identity/attributes/attributes.error-codes.js';
import { USER_ERRORS } from '../src/identity/users/users.error-codes.js';
import { createE2eApp } from './setup/app.js';
import {
  bearer,
  grantAttributesDirectly,
  loginForToken,
  seedVerifiedUser,
  truncateForAuthorization,
} from './setup/authorization.js';
import { clearAuthKeys } from './setup/redis.js';

const PASSWORD = 'Str0ngPassw';

describe('Authorization (e2e)', () => {
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
    const tag = `${prefix}-${Date.now()}-${counter}`;
    return {
      email: `${tag}@example.com`,
      username: `u_${tag.replace(/-/g, '_')}`,
    };
  }

  /** Seeds a verified superuser. */
  async function seedSuperuser(): Promise<{
    id: string;
    email: string;
    username: string;
  }> {
    const identity = uniqueIdentity('root');
    const id = await seedVerifiedUser(dataSource, {
      ...identity,
      password: PASSWORD,
      isSuperuser: true,
    });

    return { id, ...identity };
  }

  /** Seeds a verified regular user. */
  async function seedRegularUser(prefix = 'user'): Promise<{
    id: string;
    email: string;
    username: string;
  }> {
    const identity = uniqueIdentity(prefix);
    const id = await seedVerifiedUser(dataSource, {
      ...identity,
      password: PASSWORD,
    });

    return { id, ...identity };
  }

  it('superusers hold the whole catalog and can bootstrap grants through the API', async () => {
    const root = await seedSuperuser();
    const user = await seedRegularUser();
    const rootToken = await loginForToken(app, root.email, PASSWORD);
    const userToken = await loginForToken(app, user.email, PASSWORD);

    // The catalog is readable by any authenticated user.
    const catalog = await request(app.getHttpServer())
      .get('/attributes')
      .set(bearer(rootToken))
      .expect(200);
    expect(catalog.body.data.attributes).toHaveLength(12);
    expect(
      catalog.body.data.attributes.map((entry: { key: string }) => entry.key),
    ).toEqual(expect.arrayContaining(['users:create', 'groups:read']));

    // The plain user has no capabilities yet.
    await request(app.getHttpServer())
      .get('/users')
      .set(bearer(userToken))
      .expect(403);

    // Grant directly on the user (idempotent).
    await request(app.getHttpServer())
      .put(`/users/${user.id}/attributes/users:read`)
      .set(bearer(rootToken))
      .expect(200);
    await request(app.getHttpServer())
      .put(`/users/${user.id}/attributes/users:read`)
      .set(bearer(rootToken))
      .expect(200);

    // The grant takes effect immediately: `users:read` opens the route.
    await request(app.getHttpServer())
      .get('/users')
      .set(bearer(userToken))
      .expect(200);

    // ...and revoke again.
    await request(app.getHttpServer())
      .delete(`/users/${user.id}/attributes/users:read`)
      .set(bearer(rootToken))
      .expect(200);

    await request(app.getHttpServer())
      .get('/users')
      .set(bearer(userToken))
      .expect(403);
  });

  it('rejects unknown users, malformed ids and unknown attributes', async () => {
    const root = await seedSuperuser();
    const user = await seedRegularUser();
    const rootToken = await loginForToken(app, root.email, PASSWORD);

    const missingUser = await request(app.getHttpServer())
      .put(`/users/${randomUUID()}/attributes/users:read`)
      .set(bearer(rootToken))
      .expect(404);
    expect(missingUser.body.error.code).toBe(USER_ERRORS.userNotFound);

    const malformed = await request(app.getHttpServer())
      .get('/users/not-a-uuid')
      .set(bearer(rootToken))
      .expect(400);
    expect(malformed.body.error.message).toContain('uuid');

    const unknownAttribute = await request(app.getHttpServer())
      .put(`/users/${user.id}/attributes/users:nope`)
      .set(bearer(rootToken))
      .expect(404);
    expect(unknownAttribute.body.error.code).toBe(
      ATTRIBUTE_ERRORS.unknownAttribute,
    );
  });

  it('group membership and attachment produce effective attributes', async () => {
    const root = await seedSuperuser();
    const member = await seedRegularUser('member');
    const rootToken = await loginForToken(app, root.email, PASSWORD);

    const created = await request(app.getHttpServer())
      .post('/groups')
      .set(bearer(rootToken))
      .send({ name: 'Moderators', description: 'The moderation team.' })
      .expect(201);
    const groupId = created.body.data.id as string;

    const firstAttach = await request(app.getHttpServer())
      .put(`/groups/${groupId}/attributes/users:read`)
      .set(bearer(rootToken))
      .expect(200);
    expect(firstAttach.body.data.attributes).toEqual(['users:read']);

    const secondAttach = await request(app.getHttpServer())
      .put(`/groups/${groupId}/attributes/groups:read`)
      .set(bearer(rootToken))
      .expect(200);
    expect(secondAttach.body.data.attributes).toEqual([
      'groups:read',
      'users:read',
    ]);

    await request(app.getHttpServer())
      .put(`/groups/${groupId}/members/${member.id}`)
      .set(bearer(rootToken))
      .expect(200);

    // The member now holds both keys: both management routes open up.
    const memberToken = await loginForToken(app, member.email, PASSWORD);
    await request(app.getHttpServer())
      .get('/groups')
      .set(bearer(memberToken))
      .expect(200);
    await request(app.getHttpServer())
      .get('/users')
      .set(bearer(memberToken))
      .expect(200);

    // The group view reflects the attachment and the membership.
    const detail = await request(app.getHttpServer())
      .get(`/groups/${groupId}`)
      .set(bearer(rootToken))
      .expect(200);
    expect(detail.body.data.attributes).toEqual(['groups:read', 'users:read']);
    expect(detail.body.data.members).toEqual([member.id]);

    // Removing the membership revokes the effective attributes.
    await request(app.getHttpServer())
      .delete(`/groups/${groupId}/members/${member.id}`)
      .set(bearer(rootToken))
      .expect(200);

    await request(app.getHttpServer())
      .get('/groups')
      .set(bearer(memberToken))
      .expect(403);
    await request(app.getHttpServer())
      .get('/users')
      .set(bearer(memberToken))
      .expect(403);
  });

  it('enforces the subset rule on direct grants and memberships', async () => {
    const root = await seedSuperuser();
    const grantee = await seedRegularUser('grantee');
    const actor = await seedRegularUser('actor');
    await grantAttributesDirectly(dataSource, actor.id, [
      'users:read',
      'users:assign_attributes',
      'groups:manage_members',
    ]);
    const actorToken = await loginForToken(app, actor.email, PASSWORD);

    // The actor holds users:read — but not users:delete.
    await request(app.getHttpServer())
      .put(`/users/${grantee.id}/attributes/users:read`)
      .set(bearer(actorToken))
      .expect(200);

    const escalated = await request(app.getHttpServer())
      .put(`/users/${grantee.id}/attributes/users:delete`)
      .set(bearer(actorToken))
      .expect(403);
    expect(escalated.body.error.code).toBe(
      ATTRIBUTE_ERRORS.insufficientAttributes,
    );
    expect(escalated.body.error.meta.required).toEqual(['users:delete']);

    // Adding a member hands out the group's attributes — same subset rule.
    const rootToken = await loginForToken(app, root.email, PASSWORD);
    const created = await request(app.getHttpServer())
      .post('/groups')
      .set(bearer(rootToken))
      .send({ name: 'Operators' })
      .expect(201);
    await request(app.getHttpServer())
      .put(`/groups/${created.body.data.id}/attributes/users:delete`)
      .set(bearer(rootToken))
      .expect(200);

    const membershipEscalation = await request(app.getHttpServer())
      .put(`/groups/${created.body.data.id}/members/${grantee.id}`)
      .set(bearer(actorToken))
      .expect(403);
    expect(membershipEscalation.body.error.code).toBe(
      ATTRIBUTE_ERRORS.insufficientAttributes,
    );
    expect(membershipEscalation.body.error.meta.required).toEqual([
      'users:delete',
    ]);

    // Superusers bypass the subset rule.
    await request(app.getHttpServer())
      .put(`/groups/${created.body.data.id}/members/${grantee.id}`)
      .set(bearer(rootToken))
      .expect(200);
  });

  it('protects superuser accounts from regular administrators', async () => {
    const root = await seedSuperuser();
    const admin = await seedRegularUser('admin');
    await grantAttributesDirectly(dataSource, admin.id, [
      'users:update',
      'users:delete',
      'users:assign_attributes',
    ]);
    const adminToken = await loginForToken(app, admin.email, PASSWORD);

    const update = await request(app.getHttpServer())
      .patch(`/users/${root.id}`)
      .set(bearer(adminToken))
      .send({ firstName: 'Hacked' })
      .expect(403);
    expect(update.body.error.code).toBe(ADMIN_USER_ERRORS.superuserProtected);

    const removal = await request(app.getHttpServer())
      .delete(`/users/${root.id}`)
      .set(bearer(adminToken))
      .expect(403);
    expect(removal.body.error.code).toBe(ADMIN_USER_ERRORS.superuserProtected);

    const grant = await request(app.getHttpServer())
      .put(`/users/${root.id}/attributes/users:read`)
      .set(bearer(adminToken))
      .expect(403);
    expect(grant.body.error.code).toBe(ADMIN_USER_ERRORS.superuserProtected);

    // Superusers may modify their own row (and other admins).
    const rootToken = await loginForToken(app, root.email, PASSWORD);
    const selfUpdate = await request(app.getHttpServer())
      .patch(`/users/${root.id}`)
      .set(bearer(rootToken))
      .send({ firstName: 'Root' })
      .expect(200);
    expect(selfUpdate.body.data.firstName).toBe('Root');

    await request(app.getHttpServer())
      .patch(`/users/${admin.id}`)
      .set(bearer(rootToken))
      .send({ lastName: 'Admin' })
      .expect(200);
  });

  it('rejects unauthenticated calls and callers without attributes', async () => {
    const user = await seedRegularUser('plain');

    // No token at all.
    await request(app.getHttpServer()).get('/users').expect(401);
    await request(app.getHttpServer()).get('/groups').expect(401);
    await request(app.getHttpServer()).get('/attributes').expect(401);

    // Authenticated but without any grant.
    const token = await loginForToken(app, user.email, PASSWORD);

    const users = await request(app.getHttpServer())
      .get('/users')
      .set(bearer(token))
      .expect(403);
    expect(users.body.error.code).toBe(ATTRIBUTE_ERRORS.insufficientAttributes);
    expect(users.body.error.meta.required).toEqual(['users:read']);

    await request(app.getHttpServer())
      .get('/groups')
      .set(bearer(token))
      .expect(403);

    // The catalog itself stays readable by any authenticated user.
    const catalog = await request(app.getHttpServer())
      .get('/attributes')
      .set(bearer(token))
      .expect(200);
    expect(catalog.body.data.attributes).toHaveLength(12);
  });
});
