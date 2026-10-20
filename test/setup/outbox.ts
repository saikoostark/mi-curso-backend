import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TEST_OUTBOX_DIR } from './env.js';

/** One email as persisted by the file-based outbox. */
export interface OutboxEmail {
  to: string;
  subject: string;
  text: string;
  sentAt: string;
}

/**
 * Reads every email the file outbox has written during this run.
 *
 * @returns Parsed emails in send order; empty when nothing was sent yet.
 */
export async function readOutbox(): Promise<OutboxEmail[]> {
  try {
    const raw = await readFile(join(TEST_OUTBOX_DIR, 'outbox.jsonl'), 'utf8');
    return raw
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as OutboxEmail);
  } catch {
    return [];
  }
}

/**
 * Finds the most recent email sent to an address.
 *
 * @param to - Recipient address.
 * @returns The email.
 * @throws Error when no email was sent to that address.
 */
export async function findLatestEmail(to: string): Promise<OutboxEmail> {
  const emails = (await readOutbox()).filter((email) => email.to === to);
  const latest = emails.at(-1);

  if (!latest) {
    throw new Error(`No outbox email found for ${to}`);
  }

  return latest;
}

/**
 * Extracts the first `token=...` value from an email body (verification and
 * reset links both carry the token as a query parameter).
 *
 * @param text - Email body.
 * @returns The raw token.
 */
export function extractToken(text: string): string {
  const match = /[?&]token=([A-Za-z0-9_-]+)/.exec(text);

  if (!match?.[1]) {
    throw new Error('No token found in email body');
  }

  return match[1];
}
