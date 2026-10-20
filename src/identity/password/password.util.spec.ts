import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
} from './password.util.js';

describe('password.util (scrypt)', () => {
  it('hashes into the documented scrypt$N$r$p$salt$hash format', async () => {
    const hash = await hashPassword('Corr3ctHorseBattery');

    expect(hash).toMatch(
      /^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/,
    );
  });

  it('verifies a correct password against its hash', async () => {
    const hash = await hashPassword('Corr3ctHorseBattery');

    await expect(verifyPassword('Corr3ctHorseBattery', hash)).resolves.toBe(
      true,
    );
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('Corr3ctHorseBattery');

    await expect(verifyPassword('Wr0ngPassword', hash)).resolves.toBe(false);
  });

  it('produces a different hash per call (random salt)', async () => {
    const first = await hashPassword('Corr3ctHorseBattery');
    const second = await hashPassword('Corr3ctHorseBattery');

    expect(first).not.toBe(second);
  });

  it('rejects malformed stored hashes without throwing', async () => {
    await expect(verifyPassword('anything', 'not-a-hash')).resolves.toBe(false);
    await expect(
      verifyPassword('anything', 'bcrypt$12$whatever'),
    ).resolves.toBe(false);
    await expect(verifyPassword('anything', '')).resolves.toBe(false);
  });

  it('keeps the dummy hash well-formed and unusable for real passwords', async () => {
    expect(DUMMY_PASSWORD_HASH).toMatch(
      /^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/,
    );
    await expect(
      verifyPassword('some-random-attempt', DUMMY_PASSWORD_HASH),
    ).resolves.toBe(false);
  });
});
