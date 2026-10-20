import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  DEFAULT_JWT_AUDIENCE,
  DEFAULT_JWT_ISSUER,
} from './token.constants.js';

/**
 * Payload carried by access tokens. `iat`/`exp` are added by the JWT library.
 */
export interface AccessTokenPayload {
  /** User id. */
  sub: string;
  /** Token id, used for per-token revocation. */
  jti: string;
  /**
   * Issue time in milliseconds. The standard `iat` claim only has second
   * precision, which cannot express the revocation rule: a token minted in the
   * same second as a logout must still die, while one minted right after the
   * logout (fresh login) must live. The watermark compares against `iatMs`.
   */
  iatMs: number;
  iat: number;
  exp: number;
}

/**
 * A freshly signed access token plus the data the session ledger stores so the
 * exact token can be denylisted later (jti + expiry).
 */
export interface SignedAccessToken {
  /** Raw JWT for the response body. */
  token: string;
  /** Token id (`jti` claim). */
  jti: string;
  /**
   * Millisecond expiry, padded slightly past the JWT `exp` claim (which only
   * has second precision) so a denylist entry computed from it can never
   * expire while the guard still accepts the token.
   */
  expiresAtMs: number;
}

/** One verification key: the secret and the `kid` written into the header. */
interface JwtKey {
  secret: string;
  kid: string;
}

/**
 * Signs and verifies access tokens.
 *
 * Every token carries `iss`, `aud` and a `kid` header so an environment can
 * rotate `JWT_SECRET` without a flag day: the previous secret stays in
 * `JWT_SECRET_PREVIOUS` and is accepted for verification during its 15-minute
 * tail. Tokens signed before this contract (no issuer/audience) are rejected,
 * which is the intended forced re-login on deploy.
 */
@Injectable()
export class AccessTokenService {
  private readonly currentKey: JwtKey;
  private readonly previousKey: JwtKey | null;
  private readonly issuer: string;
  private readonly audience: string;

  constructor(
    private readonly jwtService: JwtService,
    config: ConfigService,
  ) {
    this.currentKey = keyFor(config.getOrThrow<string>('JWT_SECRET'));
    const previous = config.get<string>('JWT_SECRET_PREVIOUS');
    this.previousKey =
      previous && previous.trim() !== '' ? keyFor(previous) : null;
    this.issuer =
      config.get<string>('JWT_ISSUER')?.trim() || DEFAULT_JWT_ISSUER;
    this.audience =
      config.get<string>('JWT_AUDIENCE')?.trim() || DEFAULT_JWT_AUDIENCE;
  }

  /**
   * Issues a short-lived access token for a user.
   *
   * @param userId - User id (becomes the `sub` claim).
   * @returns Signed JWT plus its `jti` and millisecond expiry.
   */
  async signAccessToken(userId: string): Promise<SignedAccessToken> {
    const jti = randomUUID();
    const issuedAtMs = Date.now();
    const token = await this.jwtService.signAsync(
      {
        sub: userId,
        jti,
        iatMs: issuedAtMs,
      },
      {
        secret: this.currentKey.secret,
        keyid: this.currentKey.kid,
        algorithm: 'HS256',
        issuer: this.issuer,
        audience: this.audience,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      },
    );

    // jsonwebtoken truncates `iat` to whole seconds, so the exact `exp` is
    // `floor(iat/1000) + TTL` seconds; the extra second keeps the stored
    // expiry strictly after the claim.
    const expiresAtMs =
      (Math.floor(issuedAtMs / 1000) + ACCESS_TOKEN_TTL_SECONDS) * 1000 + 1000;

    return { token, jti, expiresAtMs };
  }

  /**
   * Verifies signature, expiry, issuer, audience and key id of an access
   * token.
   *
   * @param token - Raw JWT.
   * @returns Decoded payload; throws when invalid or expired.
   */
  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    const keys = this.candidatesFor(token);
    if (keys.length === 0) {
      throw new Error('Invalid access token.');
    }

    for (const key of keys) {
      try {
        return await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
          secret: key.secret,
          algorithms: ['HS256'],
          issuer: this.issuer,
          audience: this.audience,
        });
      } catch {
        // Try the next key; the final failure is reported below without
        // leaking which check (signature, issuer, expiry) failed.
      }
    }

    throw new Error('Invalid access token.');
  }

  /**
   * Selects the key(s) a token may have been signed with.
   *
   * A known `kid` pins verification to exactly one secret; a missing `kid`
   * (legacy token) tries both so the error is still generic. An unknown `kid`
   * is rejected outright.
   */
  private candidatesFor(token: string): JwtKey[] {
    const decoded = this.jwtService.decode(token, { complete: true }) as {
      header?: { kid?: unknown };
    } | null;
    const kid = decoded?.header?.kid;

    if (kid === undefined) {
      return [this.currentKey, this.previousKey].filter(
        (key): key is JwtKey => key !== null,
      );
    }

    if (typeof kid !== 'string') {
      return [];
    }

    return [this.currentKey, this.previousKey].filter(
      (key): key is JwtKey => key !== null && key.kid === kid,
    );
  }
}

/**
 * Derives a stable, non-secret key id from a signing secret.
 *
 * Using a hash rather than an extra env var means rotation only needs the new
 * secret (and the old one during the overlap), and identical secrets always
 * map to the same `kid`.
 *
 * @param secret - Raw JWT signing secret.
 * @returns Short public key id.
 */
function keyFor(secret: string): JwtKey {
  const kid = createHash('sha256').update(secret).digest('hex').slice(0, 16);
  return { secret, kid };
}
