import { Module } from '@nestjs/common';
import { EmailService } from './email.service.js';
import { FileEmailService } from './file-email.service.js';

/**
 * Binds the `EmailService` port to the file-based development adapter.
 */
@Module({
  providers: [{ provide: EmailService, useClass: FileEmailService }],
  exports: [EmailService],
})
export class EmailModule {}
