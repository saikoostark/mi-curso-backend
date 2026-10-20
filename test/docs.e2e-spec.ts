import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { setupSwagger } from '../src/common/swagger/setup-swagger.js';
import { REFRESH_COOKIE_NAME } from '../src/identity/token/token.constants.js';
import { createE2eApp } from './setup/app.js';

/** Minimal shape of the generated document the spec asserts against. */
interface OpenApiDocument {
  paths: Record<string, unknown>;
  components: {
    securitySchemes: Record<
      string,
      { type: string; scheme?: string; in?: string; name?: string }
    >;
    schemas: Record<string, { properties?: Record<string, unknown> }>;
  };
}

describe('OpenAPI document (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp((application) =>
      setupSwagger(application, REFRESH_COOKIE_NAME),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('is served at /docs-json with application paths and security schemes', async () => {
    const response = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);

    const document = response.body as OpenApiDocument;

    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        '/auth/login',
        '/auth/refresh',
        '/auth/me',
        '/users',
        '/users/{id}',
        '/groups',
        '/attributes',
        '/health',
      ]),
    );

    expect(document.components.securitySchemes).toMatchObject({
      'access-token': { type: 'http', scheme: 'bearer' },
      'refresh-cookie': {
        type: 'apiKey',
        in: 'cookie',
        name: REFRESH_COOKIE_NAME,
      },
    });

    // Explicit response schemas documented on the UserView class; request DTO
    // properties are filled in by the Swagger CLI plugin at build time.
    expect(document.components.schemas.UserView.properties).toHaveProperty(
      'emailVerified',
    );
  });
});
