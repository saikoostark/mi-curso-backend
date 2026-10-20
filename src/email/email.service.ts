/**
 * A message handed to an `EmailService` implementation.
 */
export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Port for outbound email delivery.
 *
 * The application only depends on this abstraction; the concrete
 * implementation is provided by `EmailModule`. The current development
 * implementation writes files (see `FileEmailService`) — a real SMTP/API
 * adapter can replace it without touching any caller.
 */
export abstract class EmailService {
  /**
   * Delivers a single email.
   *
   * @param email - Recipient, subject and plain-text body.
   */
  abstract send(email: OutboundEmail): Promise<void>;
}
