import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { setupSwagger } from './common/swagger/setup-swagger.js';
import { REFRESH_COOKIE_NAME } from './identity/token/token.constants.js';

async function bootstrap() {
  // Buffer the startup logs until pino is the active logger, so nothing is
  // emitted in Nest's default format.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);
  setupSwagger(app, REFRESH_COOKIE_NAME);
  // Close HTTP, TypeORM and Redis cleanly on SIGTERM/SIGINT (containers send
  // SIGTERM on deploy); Nest's shutdown hooks are opt-in.
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}

await bootstrap();
