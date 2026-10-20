import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipApiEnvelope } from './common/http/skip-api-envelope.decorator.js';
import { AppService } from './app.service.js';

/**
 * Root probe. It stays outside the API envelope and the OpenAPI document; the
 * real surface lives under `/auth`, `/users`, `/groups` and `/attributes`.
 */
@ApiExcludeController()
@SkipApiEnvelope()
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
