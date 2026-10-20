import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AccessTokenService } from './access-token.service.js';

/** ConfigService double backed by a plain map. */
function createConfig(
  values: Record<string, string | undefined>,
): ConfigService {
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      const value = values[key];
      if (value === undefined) {
        throw new Error(`Missing configuration: ${key}`);
      }
      return value;
    },
  } as unknown as ConfigService;
}

/** Header of a decoded JWT. */
function headerOf(jwt: JwtService, token: string): { kid?: string } {
  const decoded = jwt.decode(token, { complete: true }) as {
    header: { kid?: string };
  };
  return decoded.header;
}

describe('AccessTokenService', () => {
  const jwt = new JwtService();
  const baseConfig = {
    JWT_SECRET: 'current-test-secret',
    JWT_ISSUER: 'micurso',
    JWT_AUDIENCE: 'micurso-api',
  };

  it('signs and verifies a token with issuer, audience and key id', async () => {
    const service = new AccessTokenService(jwt, createConfig(baseConfig));

    const signed = await service.signAccessToken('user-1');
    const payload = await service.verifyAccessToken(signed.token);
    const decoded = jwt.decode(signed.token, { complete: true }) as {
      header: { kid?: string };
      payload: { iss?: string; aud?: string };
    };

    expect(payload.sub).toBe('user-1');
    expect(payload.jti).toBe(signed.jti);
    expect(payload.iatMs).toEqual(expect.any(Number));
    expect(decoded.header.kid).toBeDefined();
    expect(decoded.payload.iss).toBe('micurso');
    expect(decoded.payload.aud).toBe('micurso-api');
  });

  it('accepts tokens signed with the previous secret during rotation', async () => {
    const before = new AccessTokenService(jwt, createConfig(baseConfig));
    const oldToken = await before.signAccessToken('user-1');

    const rotated = new AccessTokenService(
      jwt,
      createConfig({
        ...baseConfig,
        JWT_SECRET: 'new-test-secret',
        JWT_SECRET_PREVIOUS: baseConfig.JWT_SECRET,
      }),
    );

    await expect(
      rotated.verifyAccessToken(oldToken.token),
    ).resolves.toMatchObject({ sub: 'user-1' });

    const newToken = await rotated.signAccessToken('user-1');
    await expect(before.verifyAccessToken(newToken.token)).rejects.toThrow(
      'Invalid access token.',
    );
  });

  it('rejects tokens with the wrong issuer or audience', async () => {
    const service = new AccessTokenService(jwt, createConfig(baseConfig));
    const signed = await service.signAccessToken('user-1');
    const kid = headerOf(jwt, signed.token).kid;

    const wrongIssuer = jwt.sign(
      { sub: 'user-1', jti: 'x', iatMs: Date.now() },
      {
        secret: baseConfig.JWT_SECRET,
        keyid: kid,
        issuer: 'somebody-else',
        audience: 'micurso-api',
        expiresIn: 60,
      },
    );
    const wrongAudience = jwt.sign(
      { sub: 'user-1', jti: 'x', iatMs: Date.now() },
      {
        secret: baseConfig.JWT_SECRET,
        keyid: kid,
        issuer: 'micurso',
        audience: 'other-api',
        expiresIn: 60,
      },
    );

    await expect(service.verifyAccessToken(wrongIssuer)).rejects.toThrow();
    await expect(service.verifyAccessToken(wrongAudience)).rejects.toThrow();
  });

  it('rejects an unknown key id and an expired token', async () => {
    const service = new AccessTokenService(jwt, createConfig(baseConfig));

    const unknownKid = jwt.sign(
      { sub: 'user-1', jti: 'x', iatMs: Date.now() },
      {
        secret: baseConfig.JWT_SECRET,
        keyid: 'not-a-real-kid',
        issuer: 'micurso',
        audience: 'micurso-api',
        expiresIn: 60,
      },
    );
    await expect(service.verifyAccessToken(unknownKid)).rejects.toThrow();

    const signed = await service.signAccessToken('user-1');
    const kid = headerOf(jwt, signed.token).kid;
    const expired = jwt.sign(
      { sub: 'user-1', jti: 'x', iatMs: Date.now() },
      {
        secret: baseConfig.JWT_SECRET,
        keyid: kid,
        issuer: 'micurso',
        audience: 'micurso-api',
        expiresIn: -1,
      },
    );
    await expect(service.verifyAccessToken(expired)).rejects.toThrow();
  });
});
