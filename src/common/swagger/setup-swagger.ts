import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Serves the OpenAPI document and Swagger UI at `/docs`.
 *
 * The document is generated from controller decorators and DTO metadata. Two
 * security schemes are registered: the access-token bearer header used by most
 * routes, and the refresh-token cookie used only by `POST /auth/refresh`.
 *
 * @param app - Configured Nest application.
 * @param refreshCookieName - Name of the httpOnly refresh-token cookie.
 */
export function setupSwagger(
  app: INestApplication,
  refreshCookieName: string,
): void {
  const config = new DocumentBuilder()
    .setTitle('Mi Curso API')
    .setDescription(
      'Course-management backend. Successful responses use `{ success, data }`; ' +
        'paged lists put the rows under `data.page` and metadata under ' +
        '`data.pagination`. Errors use `{ success: false, error }`.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token returned by login/refresh.',
      },
      'access-token',
    )
    .addCookieAuth(
      refreshCookieName,
      { type: 'apiKey', in: 'cookie' },
      'refresh-cookie',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
}
