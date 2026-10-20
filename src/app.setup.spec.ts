import type { INestApplication } from '@nestjs/common';
import {
  configureApp,
  parseCorsOrigins,
  parseTrustProxy,
} from './app.setup.js';

/** Minimal application double for the shared setup function. */
function createAppMock(): {
  app: INestApplication;
  set: ReturnType<typeof vi.fn>;
  use: ReturnType<typeof vi.fn>;
  useGlobalPipes: ReturnType<typeof vi.fn>;
  enableCors: ReturnType<typeof vi.fn>;
} {
  const set = vi.fn();
  const use = vi.fn();
  const useGlobalPipes = vi.fn();
  const enableCors = vi.fn();
  const getHttpAdapter = vi.fn().mockReturnValue({
    getInstance: () => ({ set }),
  });

  return {
    app: {
      getHttpAdapter,
      use,
      useGlobalPipes,
      enableCors,
    } as unknown as INestApplication,
    set,
    use,
    useGlobalPipes,
    enableCors,
  };
}

describe('parseTrustProxy', () => {
  it.each([
    ['true', true],
    ['false', false],
    ['1', 1],
    ['3', 3],
    ['loopback', 'loopback'],
    ['10.0.0.0/8,172.16.0.0/12', '10.0.0.0/8,172.16.0.0/12'],
    [' 2 ', 2],
  ])('parses %j as %j', (raw, expected) => {
    expect(parseTrustProxy(raw)).toEqual(expected);
  });
});

describe('parseCorsOrigins', () => {
  it('splits, trims and normalizes the allowlist', () => {
    expect(
      parseCorsOrigins(
        ' https://app.example.com/ , https://admin.example.com ,, ',
      ),
    ).toEqual(['https://app.example.com', 'https://admin.example.com']);
  });

  it('treats an unset or blank value as no CORS surface', () => {
    expect(parseCorsOrigins(undefined)).toEqual([]);
    expect(parseCorsOrigins('   ')).toEqual([]);
  });

  it('rejects the wildcard origin', () => {
    expect(() => parseCorsOrigins('https://app.example.com,*')).toThrow(
      'CORS_ORIGINS',
    );
  });
});

describe('configureApp', () => {
  const originalTrustProxy = process.env.TRUST_PROXY;
  const originalCorsOrigins = process.env.CORS_ORIGINS;

  afterEach(() => {
    if (originalTrustProxy === undefined) {
      delete process.env.TRUST_PROXY;
    } else {
      process.env.TRUST_PROXY = originalTrustProxy;
    }
    if (originalCorsOrigins === undefined) {
      delete process.env.CORS_ORIGINS;
    } else {
      process.env.CORS_ORIGINS = originalCorsOrigins;
    }
  });

  it('applies TRUST_PROXY to the Express instance when set', () => {
    process.env.TRUST_PROXY = '1';
    const { app, set } = createAppMock();

    configureApp(app);

    expect(set).toHaveBeenCalledWith('trust proxy', 1);
  });

  it('leaves the proxy setting alone when TRUST_PROXY is unset or blank', () => {
    const { app, set } = createAppMock();

    delete process.env.TRUST_PROXY;
    configureApp(app);
    process.env.TRUST_PROXY = '   ';
    configureApp(app);

    expect(set).not.toHaveBeenCalled();
  });

  it('always installs cookie parsing and the shared validation pipe', () => {
    delete process.env.CORS_ORIGINS;
    const { app, use, useGlobalPipes } = createAppMock();

    configureApp(app);

    expect(use).toHaveBeenCalledTimes(1);
    expect(useGlobalPipes).toHaveBeenCalledTimes(1);
  });

  it('does not enable CORS when no allowlist is configured', () => {
    delete process.env.CORS_ORIGINS;
    const { app, enableCors } = createAppMock();

    configureApp(app);

    expect(enableCors).not.toHaveBeenCalled();
  });

  it('enables credentialed CORS for the explicit allowlist only', () => {
    process.env.CORS_ORIGINS =
      'https://app.example.com,https://admin.example.com';
    const { app, enableCors } = createAppMock();

    configureApp(app);

    expect(enableCors).toHaveBeenCalledTimes(1);
    const options = enableCors.mock.calls[0][0] as {
      credentials: boolean;
      origin: (
        origin: string | undefined,
        callback: (error: Error | null, allow?: boolean) => void,
      ) => void;
    };
    expect(options.credentials).toBe(true);

    const callback = vi.fn();
    options.origin('https://app.example.com', callback);
    expect(callback).toHaveBeenCalledWith(null, true);

    options.origin('https://evil.example.com', callback);
    expect(callback).toHaveBeenCalledWith(null, false);

    // Same-origin/curl requests carry no Origin and are not CORS requests.
    options.origin(undefined, callback);
    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it('fails loudly when the wildcard origin is configured', () => {
    process.env.CORS_ORIGINS = '*';
    const { app } = createAppMock();

    expect(() => configureApp(app)).toThrow('CORS_ORIGINS');
  });
});
