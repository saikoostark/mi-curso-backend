import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';

/**
 * Boots the full application for an e2e spec.
 *
 * Applies the same HTTP setup as `main.ts` (cookie parsing, DTO validation
 * pipe) so specs exercise identical request handling. An optional callback runs
 * after that setup but before `init()`, for registrations that `main.ts` also
 * performs pre-listen (currently the Swagger document).
 *
 * @param beforeInit - Hook invoked with the configured app before `init()`.
 * @returns The initialized Nest application.
 */
export async function createE2eApp(
  beforeInit?: (app: INestApplication<App>) => void,
): Promise<INestApplication<App>> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  configureApp(app);
  beforeInit?.(app);
  await app.init();

  return app;
}
