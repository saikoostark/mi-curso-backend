import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { createE2eApp } from './setup/app.js';
import { getTestDatabaseUrl } from './setup/env.js';

describe('HealthController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/health (GET) reports the process as alive', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200);

    expect(response.body).toEqual({ status: 'ok' });
  });

  it('/ready (GET) checks Postgres and Redis', async () => {
    const response = await request(app.getHttpServer())
      .get('/ready')
      .expect(200);

    expect(response.body).toMatchObject({
      status: 'ready',
      checks: {
        database: { status: 'up' },
        redis: { status: 'up' },
      },
    });
    expect(response.body.checks.database.latencyMs).toEqual(expect.any(Number));
    expect(response.body.timestamp).toEqual(expect.any(String));
    // Raw infrastructure body: no API envelope.
    expect(response.body).not.toHaveProperty('success');
  });

  it('/metrics (GET) exposes raw process and dependency telemetry', async () => {
    const response = await request(app.getHttpServer())
      .get('/metrics')
      .expect(200);

    expect(response.body).toMatchObject({
      status: 'ready',
      uptimeSeconds: expect.any(Number),
      process: {
        pid: expect.any(Number),
        node: expect.any(String),
        memory: { rss: expect.any(Number) },
      },
      dependencies: {
        database: { status: 'up' },
        redis: { status: 'up' },
      },
    });
    expect(response.body).not.toHaveProperty('success');
  });

  it('/metrics requires the configured metrics token', async () => {
    const previous = process.env.METRICS_TOKEN;
    process.env.METRICS_TOKEN = 'metrics-e2e-secret';
    const secured = await createE2eApp();

    try {
      const denied = await request(secured.getHttpServer())
        .get('/metrics')
        .expect(401);
      expect(denied.body.error.code).toBe('unauthorized');

      await request(secured.getHttpServer())
        .get('/metrics')
        .set('Authorization', 'Bearer wrong-secret')
        .expect(401);

      await request(secured.getHttpServer())
        .get('/metrics')
        .set('Authorization', 'Bearer metrics-e2e-secret')
        .expect(200);
    } finally {
      await secured.close();
      if (previous === undefined) {
        delete process.env.METRICS_TOKEN;
      } else {
        process.env.METRICS_TOKEN = previous;
      }
    }
  });

  it('is connected to the dedicated test database', async () => {
    const expectedName = new URL(getTestDatabaseUrl()).pathname.replace(
      /^\//,
      '',
    );
    const dataSource = app.get(DataSource);
    const [row] = await dataSource.query<{ name: string }[]>(
      'SELECT current_database() AS name',
    );

    expect(row.name).toBe(expectedName);
  });
});
