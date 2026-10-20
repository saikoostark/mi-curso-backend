import { ConflictException, Injectable } from '@nestjs/common';
import { PasswordService } from '../../password/password.service.js';
import type { RateLimitRule } from '../../../rate-limit/rate-limiter.js';
import { RateLimiter } from '../../../rate-limit/rate-limiter.js';
import { AuthTokenService } from '../../token/auth-token.service.js';
import { normalizeIdentity } from '../../users/user.util.js';
import { UserProvisioningService } from '../../users/user-provisioning.service.js';
import { USER_ERRORS } from '../../users/users.error-codes.js';
import { UsersService } from '../../users/users.service.js';
import type { RequestMeta } from '../auth.types.js';
import { EmailVerificationService } from '../email-verification.service.js';
import { identifierLimitKey, ipLimitKey } from '../rate-limit-keys.js';
import type { RegisterDto } from './dto/register.dto.js';

/** Register: 5 accounts per hour per IP. */
const REGISTER_IP_RULE: RateLimitRule = { limit: 5, windowSeconds: 60 * 60 };

/** Resend verification: 3 emails per hour per identifier, 10 per hour per IP. */
const RESEND_IDENTIFIER_RULE: RateLimitRule = {
  limit: 3,
  windowSeconds: 60 * 60,
};
const RESEND_IP_RULE: RateLimitRule = { limit: 10, windowSeconds: 60 * 60 };

/**
 * The registration journey: create an unverified account, consume the
 * verification link and re-send the verification email.
 *
 * Each flow owns its rate-limiting rules; the mechanism lives behind the
 * `RateLimiter` port. HTTP concerns (status codes, request decorators) stay in
 * `RegistrationController`.
 */
@Injectable()
export class RegistrationService {
  constructor(
    private readonly users: UsersService,
    private readonly provisioning: UserProvisioningService,
    private readonly passwords: PasswordService,
    private readonly authTokens: AuthTokenService,
    private readonly verification: EmailVerificationService,
    private readonly rateLimiter: RateLimiter,
  ) {}

  /**
   * Registers an unverified account and emails the verification link.
   *
   * @param dto - Registration payload.
   * @param meta - Request metadata (IP for rate limiting).
   * @returns Generic success message.
   * @throws ConflictException when email/username are taken.
   * @throws BadRequestException on password policy/confirmation failures.
   */
  async register(
    dto: RegisterDto,
    meta: RequestMeta,
  ): Promise<{ message: string }> {
    if (meta.ip) {
      await this.rateLimiter.consume(
        ipLimitKey('register', meta.ip),
        REGISTER_IP_RULE,
      );
    }

    const email = normalizeIdentity(dto.email);
    const username = normalizeIdentity(dto.username);

    this.passwords.assertMatch(dto.password, dto.passwordConfirm);
    this.passwords.assertValid(dto.password, { email, username });

    if (await this.users.existsByEmail(email)) {
      throw new ConflictException({
        code: USER_ERRORS.emailTaken,
        message: 'This email is already registered.',
      });
    }

    if (await this.users.existsByUsername(username)) {
      throw new ConflictException({
        code: USER_ERRORS.usernameTaken,
        message: 'This username is already taken.',
      });
    }

    const passwordHash = await this.passwords.hash(dto.password);
    const { user } = await this.provisioning.createUnverified({
      email,
      username,
      passwordHash,
      profile: {
        firstName: dto.firstName ?? null,
        lastName: dto.lastName ?? null,
        phone: dto.phone ?? null,
      },
    });

    await this.verification.sendVerificationTo(user.id, user.email);

    return {
      message:
        'Registration successful. Check your email to verify your account.',
    };
  }

  /**
   * Consumes an email-verification token.
   *
   * @param token - Raw token from the verification link.
   * @returns Success message.
   * @throws BadRequestException when the token is invalid/expired.
   */
  async verifyEmail(token: string): Promise<{ message: string }> {
    const userId = await this.authTokens.consume(token, 'email_verify');
    await this.users.setEmailVerified(userId);

    return { message: 'Email verified. You can now log in.' };
  }

  /**
   * Re-sends the verification email. The response is always the same so it
   * does not reveal whether an account exists.
   *
   * @param identifier - Email or username.
   * @param meta - Request metadata (IP for rate limiting).
   * @returns Generic message.
   */
  async resendVerification(
    identifier: string,
    meta: RequestMeta,
  ): Promise<{ message: string }> {
    await this.rateLimiter.consume(
      identifierLimitKey('resend', identifier),
      RESEND_IDENTIFIER_RULE,
    );
    if (meta.ip) {
      await this.rateLimiter.consume(
        ipLimitKey('resend', meta.ip),
        RESEND_IP_RULE,
      );
    }

    const user = await this.users.findByIdentifier(
      normalizeIdentity(identifier),
    );
    if (user && user.emailVerifiedAt === null) {
      await this.verification.sendVerificationTo(user.id, user.email);
    }

    return {
      message:
        'If the account exists and is not verified yet, a verification email has been sent.',
    };
  }
}
