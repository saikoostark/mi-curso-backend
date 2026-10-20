import type { ConfigService } from '@nestjs/config';
import { RedisCacheService } from './redis-cache.service.js';

/** Fake node-redis client shared between the mock factory and the tests. */
const { client } = vi.hoisted(() => ({
  client: {
    connect: vi.fn(),
    quit: vi.fn(),
    on: vi.fn(),
    isOpen: false,
    get: vi.fn(),
    pSetEx: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
    pExpire: vi.fn(),
    pTTL: vi.fn(),
  },
}));

vi.mock('redis', () => ({
  createClient: () => client,
}));

describe('RedisCacheService', () => {
  let service: RedisCacheService;

  beforeEach(() => {
    vi.clearAllMocks();
    client.isOpen = false;

    service = new RedisCacheService({
      getOrThrow: () => 'redis://test',
    } as unknown as ConfigService);
  });

  it('connects on module init and quits on shutdown', async () => {
    await service.onModuleInit();
    expect(client.connect).toHaveBeenCalledTimes(1);

    client.isOpen = true;
    await service.onApplicationShutdown();
    expect(client.quit).toHaveBeenCalledTimes(1);
  });

  it('does not reconnect an open client', async () => {
    client.isOpen = true;

    await service.onModuleInit();

    expect(client.connect).not.toHaveBeenCalled();
  });

  it('decodes JSON values on get', async () => {
    client.get.mockResolvedValue(JSON.stringify({ attempts: 3 }));

    await expect(service.get<{ attempts: number }>('key')).resolves.toEqual({
      attempts: 3,
    });
  });

  it('returns null for missing keys', async () => {
    client.get.mockResolvedValue(null);

    await expect(service.get('key')).resolves.toBeNull();
  });

  it('stores JSON values with a millisecond TTL', async () => {
    await service.set('key', { a: 1 }, 1500);

    expect(client.pSetEx).toHaveBeenCalledWith('key', 1500, '{"a":1}');
  });

  it('deletes keys', async () => {
    await service.delete('key');

    expect(client.del).toHaveBeenCalledWith('key');
  });

  it('applies the TTL only when the counter is created', async () => {
    client.incr.mockResolvedValueOnce(1);
    await service.increment('key', 900_000);
    expect(client.pExpire).toHaveBeenCalledWith('key', 900_000);

    client.incr.mockResolvedValueOnce(2);
    await service.increment('key', 900_000);
    expect(client.pExpire).toHaveBeenCalledTimes(1);
  });

  it('maps negative pTTL results to null', async () => {
    client.pTTL.mockResolvedValueOnce(-2);
    await expect(service.ttlMs('missing')).resolves.toBeNull();

    client.pTTL.mockResolvedValueOnce(1234);
    await expect(service.ttlMs('key')).resolves.toBe(1234);
  });
});
