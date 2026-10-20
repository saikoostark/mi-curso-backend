import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { GROUP_ERRORS } from '../src/admin/groups/groups.error-codes.js';
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

describe('Groups (e2e)', () => {
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

  /** Creates a group through the API and returns its id. */
  async function createGroup(token: string, name: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/groups')
      .set(bearer(token))
      .send({ name })
      .expect(201);

    return response.body.data.id as string;
  }

  it('creates, reads, updates and deletes groups', async () => {
    const token = await superuserToken();

    const created = await request(app.getHttpServer())
      .post('/groups')
      .set(bearer(token))
      .send({ name: 'Editors', description: 'Content editors.' })
      .expect(201);
    expect(created.body.data).toMatchObject({
      name: 'Editors',
      description: 'Content editors.',
      attributes: [],
    });
    const groupId = created.body.data.id as string;

    const duplicate = await request(app.getHttpServer())
      .post('/groups')
      .set(bearer(token))
      .send({ name: 'Editors' })
      .expect(409);
    expect(duplicate.body.error.code).toBe(GROUP_ERRORS.groupNameTaken);

    await request(app.getHttpServer())
      .post('/groups')
      .set(bearer(token))
      .send({ name: 'x' })
      .expect(400);

    const list = await request(app.getHttpServer())
      .get('/groups')
      .set(bearer(token))
      .expect(200);
    expect(list.body.data.groups).toHaveLength(1);
    expect(list.body.data.groups[0].id).toBe(groupId);

    const detail = await request(app.getHttpServer())
      .get(`/groups/${groupId}`)
      .set(bearer(token))
      .expect(200);
    expect(detail.body.data).toMatchObject({
      id: groupId,
      attributes: [],
      members: [],
    });

    const updated = await request(app.getHttpServer())
      .patch(`/groups/${groupId}`)
      .set(bearer(token))
      .send({ name: 'Senior Editors', description: null })
      .expect(200);
    expect(updated.body.data).toMatchObject({
      name: 'Senior Editors',
      description: null,
    });

    // Renaming onto an existing group is rejected.
    await createGroup(token, 'Reviewers');
    const clash = await request(app.getHttpServer())
      .patch(`/groups/${groupId}`)
      .set(bearer(token))
      .send({ name: 'Reviewers' })
      .expect(409);
    expect(clash.body.error.code).toBe(GROUP_ERRORS.groupNameTaken);

    await request(app.getHttpServer())
      .delete(`/groups/${groupId}`)
      .set(bearer(token))
      .expect(200);
    await request(app.getHttpServer())
      .get(`/groups/${groupId}`)
      .set(bearer(token))
      .expect(404);

    const missing = await request(app.getHttpServer())
      .get(`/groups/${randomUUID()}`)
      .set(bearer(token))
      .expect(404);
    expect(missing.body.error.code).toBe(GROUP_ERRORS.groupNotFound);

    await request(app.getHttpServer())
      .get('/groups/not-a-uuid')
      .set(bearer(token))
      .expect(400);
  });

  it('manages attributes and members', async () => {
    const token = await superuserToken();
    const groupId = await createGroup(token, 'Moderators');

    const identity = uniqueIdentity('member');
    const memberId = await seedVerifiedUser(dataSource, {
      ...identity,
      password: PASSWORD,
    });

    // Attach is idempotent.
    const attached = await request(app.getHttpServer())
      .put(`/groups/${groupId}/attributes/users:read`)
      .set(bearer(token))
      .expect(200);
    expect(attached.body.data.attributes).toEqual(['users:read']);
    await request(app.getHttpServer())
      .put(`/groups/${groupId}/attributes/users:read`)
      .set(bearer(token))
      .expect(200);

    const unknownAttribute = await request(app.getHttpServer())
      .put(`/groups/${groupId}/attributes/users:nope`)
      .set(bearer(token))
      .expect(404);
    expect(unknownAttribute.body.error.code).toBe(
      ATTRIBUTE_ERRORS.unknownAttribute,
    );

    // Member add is idempotent too.
    await request(app.getHttpServer())
      .put(`/groups/${groupId}/members/${memberId}`)
      .set(bearer(token))
      .expect(200);
    await request(app.getHttpServer())
      .put(`/groups/${groupId}/members/${memberId}`)
      .set(bearer(token))
      .expect(200);

    const unknownMember = await request(app.getHttpServer())
      .put(`/groups/${groupId}/members/${randomUUID()}`)
      .set(bearer(token))
      .expect(404);
    expect(unknownMember.body.error.code).toBe(USER_ERRORS.userNotFound);

    const detail = await request(app.getHttpServer())
      .get(`/groups/${groupId}`)
      .set(bearer(token))
      .expect(200);
    expect(detail.body.data).toMatchObject({
      attributes: ['users:read'],
      members: [memberId],
    });

    // Removing the member revokes the group-granted attributes.
    await request(app.getHttpServer())
      .delete(`/groups/${groupId}/members/${memberId}`)
      .set(bearer(token))
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/groups/${groupId}/members/${memberId}`)
      .set(bearer(token))
      .expect(200);

    const afterRemoval = await request(app.getHttpServer())
      .get(`/groups/${groupId}`)
      .set(bearer(token))
      .expect(200);
    expect(afterRemoval.body.data.members).toEqual([]);

    // Detaching the attribute empties the group's pool.
    const detached = await request(app.getHttpServer())
      .delete(`/groups/${groupId}/attributes/users:read`)
      .set(bearer(token))
      .expect(200);
    expect(detached.body.data.attributes).toEqual([]);
  });

  it('gates group management behind attributes', async () => {
    const token = await superuserToken();
    await createGroup(token, 'Hidden');

    const identity = uniqueIdentity('plain');
    const userId = await seedVerifiedUser(dataSource, {
      ...identity,
      password: PASSWORD,
    });
    const userToken = await loginForToken(app, identity.email, PASSWORD);

    const denied = await request(app.getHttpServer())
      .get('/groups')
      .set(bearer(userToken))
      .expect(403);
    expect(denied.body.error.code).toBe(
      ATTRIBUTE_ERRORS.insufficientAttributes,
    );
    expect(denied.body.error.meta.required).toEqual(['groups:read']);

    await request(app.getHttpServer())
      .post('/groups')
      .set(bearer(userToken))
      .send({ name: 'Rebels' })
      .expect(403);

    // Granting groups:read opens exactly the intended route.
    await grantAttributesDirectly(dataSource, userId, ['groups:read']);

    const allowed = await request(app.getHttpServer())
      .get('/groups')
      .set(bearer(userToken))
      .expect(200);
    expect(allowed.body.data.groups).toHaveLength(1);

    await request(app.getHttpServer())
      .get(`/groups/${randomUUID()}`)
      .set(bearer(userToken))
      .expect(404);

    await request(app.getHttpServer())
      .post('/groups')
      .set(bearer(userToken))
      .send({ name: 'Rebels' })
      .expect(403);
  });
});
