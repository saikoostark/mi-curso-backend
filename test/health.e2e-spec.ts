import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { getTestDatabaseUrl } from './setup/env.js';

describe('HealthController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/health (GET) reports the database as up', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200);

    expect(response.body).toMatchObject({ status: 'ok', database: 'up' });
    expect(typeof response.body.responseTimeMs).toBe('number');
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
