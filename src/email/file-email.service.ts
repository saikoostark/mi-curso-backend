import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EmailService, OutboundEmail } from './email.service.js';

/**
 * Development `EmailService` that "sends" emails by writing files.
 *
 * Every message is appended as one JSON line to `outbox.jsonl` (machine
 * readable — e2e specs parse it) and written as a standalone `.txt` file
 * (human readable — open it to grab verification/reset links). The directory
 * defaults to `var/email-outbox` and can be overridden with
 * `EMAIL_OUTBOX_DIR` (e2e runs use a scratch directory).
 */
@Injectable()
export class FileEmailService extends EmailService {
  private readonly outboxDir: string;

  constructor(config: ConfigService) {
    super();
    this.outboxDir =
      config.get<string>('EMAIL_OUTBOX_DIR') ??
      join(process.cwd(), 'var', 'email-outbox');
  }

  /**
   * Persists the email to the outbox (JSONL entry + readable text file).
   *
   * @param email - Recipient, subject and plain-text body.
   */
  async send(email: OutboundEmail): Promise<void> {
    await mkdir(this.outboxDir, { recursive: true });

    const sentAt = new Date().toISOString();
    const record = JSON.stringify({ ...email, sentAt });

    await appendFile(
      join(this.outboxDir, 'outbox.jsonl'),
      `${record}\n`,
      'utf8',
    );

    const stamp = sentAt.replace(/[:.]/g, '-');
    const fileName = `${stamp}-${randomUUID().slice(0, 8)}.txt`;
    await writeFile(
      join(this.outboxDir, fileName),
      `To: ${email.to}\nSubject: ${email.subject}\nDate: ${sentAt}\n\n${email.text}\n`,
      'utf8',
    );
  }
}
