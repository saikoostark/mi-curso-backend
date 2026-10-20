import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AdminModule } from './admin/admin.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuditModule } from './audit/audit.module.js';
import { CacheModule } from './cache/cache.module.js';
import { ApiExceptionFilter } from './common/http/api-exception.filter.js';
import { ApiResponseInterceptor } from './common/http/api-response.interceptor.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { IdentityModule } from './identity/identity.module.js';

// Evaluated when this module file loads; NODE_ENV comes from the process
// environment (never from `.env`), so reading it here is safe.
const isTest = process.env.NODE_ENV === 'test';
const isProduction = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    // Structured HTTP logging; must stay first so bootstrapping messages are
    // routed through pino from the start. Tests log nothing, development gets
    // human-readable output (pino-pretty), production stays machine-readable.
    LoggerModule.forRoot({
      pinoHttp: {
        level: isTest ? 'silent' : 'info',
        // Credentials must never reach the log stream.
        redact: ['req.headers.authorization', 'req.headers.cookie'],
        transport:
          isTest || isProduction
            ? undefined
            : {
                target: 'pino-pretty',
                options: { singleLine: true },
              },
      },
    }),
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    CacheModule,
    AuditModule,
    HealthModule,
    IdentityModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global response contract: success envelopes and normalized errors for
    // every controller, including the e2e application.
    { provide: APP_INTERCEPTOR, useClass: ApiResponseInterceptor },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
