import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { ATTRIBUTE_ERRORS } from '../src/identity/attributes/attributes.error-codes.js';
import { createE2eApp } from './setup/app.js';
import {
  bearer,
  loginForToken,
  seedVerifiedUser,
} from './setup/authorization.js';
import { clearAuthKeys } from './setup/redis.js';

const PASSWORD = 'Str0ngPassw';

describe('Audit logs (e2e)', () => {
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
    // Audit rows have no FK to users on purpose, so they need their own wipe.
    await dataSource.query(
      'TRUNCATE TABLE audit_logs, refresh_tokens, auth_tokens, groups, users CASCADE',
    );
    await clearAuthKeys();
  });

  /** Unique email/username pair per call. */
  function uniqueIdentity(prefix: string): {
    email: string;
    username: string;
  } {
    counter += 1;
    const tag = `${prefix}-${Date.now().toString(36)}-${counter}`;
    return {
      email: `${tag}@example.com`,
      username: `u_${tag.replace(/-/g, '_')}`,
    };
  }

  it('rejects callers without audit:read', async () => {
    const identity = uniqueIdentity('reader');
    await seedVerifiedUser(dataSource, { ...identity, password: PASSWORD });
    const token = await loginForToken(app, identity.email, PASSWORD);

    const response = await request(app.getHttpServer())
      .get('/audit-logs')
      .set(bearer(token))
      .expect(403);

    expect(response.body.error.code).toBe(
      ATTRIBUTE_ERRORS.insufficientAttributes,
    );
    expect(response.body.error.meta.required).toEqual(['audit:read']);
  });

  it('records successful and failed mutations with filters and paging', async () => {
    const identity = uniqueIdentity('root');
    const actorUserId = await seedVerifiedUser(dataSource, {
      ...identity,
      password: PASSWORD,
      isSuperuser: true,
    });
    const token = await loginForToken(app, identity.email, PASSWORD);

    await request(app.getHttpServer())
      .post('/groups')
      .set(bearer(token))
      .send({ name: 'Audit One' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/groups')
      .set(bearer(token))
      .send({ name: 'Audit Two' })
      .expect(201);

    // A rejected mutation is still security-relevant.
    await request(app.getHttpServer())
      .post('/groups')
      .set(bearer(token))
      .send({ name: '' })
      .expect(400);

    const list = await request(app.getHttpServer())
      .get('/audit-logs')
      .set(bearer(token))
      .expect(200);

    expect(list.body.data.page.length).toBeGreaterThan(0);
    const created = (
      list.body.data.page as Array<Record<string, unknown>>
    ).find(
      (entry) =>
        entry.action === 'POST /groups' &&
        entry.success === true &&
        entry.targetType === 'groups',
    );
    expect(created).toMatchObject({
      actorUserId,
      statusCode: 201,
      success: true,
      targetType: 'groups',
    });
    expect(created).toHaveProperty('createdAt');
    expect(created).toHaveProperty('ip');

    const failed = await request(app.getHttpServer())
      .get('/audit-logs')
      .query({ success: 'false', action: 'POST /groups' })
      .set(bearer(token))
      .expect(200);
    expect(failed.body.data.pagination.total).toBe(1);
    expect(failed.body.data.page[0]).toMatchObject({
      action: 'POST /groups',
      statusCode: 400,
      success: false,
    });

    const filtered = await request(app.getHttpServer())
      .get('/audit-logs')
      .query({
        actorUserId,
        action: 'groups',
        success: 'true',
        limit: 1,
        page: 1,
      })
      .set(bearer(token))
      .expect(200);
    expect(filtered.body.data.page).toHaveLength(1);
    expect(filtered.body.data.pagination).toMatchObject({
      page: 1,
      limit: 1,
      total: 2,
      totalPages: 2,
      hasNext: true,
      hasPrevious: false,
    });
    expect(filtered.body.data.page[0].actorUserId).toBe(actorUserId);
  });
});
