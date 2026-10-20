import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * scrypt parameters (native Node, no dependencies). `N = 2^15, r = 8` costs
 * ~32 MiB and ~50-100 ms per hash — strong against GPU cracking while staying
 * usable for interactive login.
 */
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/** Algorithm prefix of the stored hash format: `scrypt$N$r$p$salt$hash`. */
const ALGORITHM = 'scrypt';

/**
 * A well-formed hash of a known dummy password, used to keep login response
 * timing constant for unknown accounts (an attacker must not be able to tell
 * "no such user" from "wrong password" by measuring the response time).
 */
export const DUMMY_PASSWORD_HASH =
  'scrypt$32768$8$1$ILijwRzdP63dVQt0l-Ud0Q$lnfgimKVaq7pEf7sXWBtiP9cjIKkVWUGF2mQFvYdNkThEQiXO2rgxebuMOk9rFp_27auK7cjsiZklZkgO69-fQ';

/**
 * Derives a scrypt key. Wrapped in a promise because `crypto.scrypt` is
 * callback based. `maxmem` is derived from the parameters so non-default
 * values read back from storage still work.
 */
function deriveKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  n: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      keyLength,
      { N: n, r, p, maxmem: 256 * n * r },
      (error, derived) => {
        if (error) {
          reject(error);
        } else {
          resolve(derived);
        }
      },
    );
  });
}

/**
 * Hashes a password with scrypt and a fresh random salt.
 *
 * @param password - Plain-text password.
 * @returns Stored hash in `scrypt$N$r$p$salt$hash` format.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await deriveKey(
    password,
    salt,
    KEY_LENGTH,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
  );

  return [
    ALGORITHM,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

/**
 * Verifies a password against a stored scrypt hash.
 *
 * @param password - Plain-text candidate.
 * @param storedHash - Value previously produced by `hashPassword`.
 * @returns `true` when the password matches; malformed hashes return `false`.
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const parts = storedHash.split('$');
  if (parts.length !== 6) {
    return false;
  }

  const [algorithm, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
  if (algorithm !== ALGORITHM) {
    return false;
  }

  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }

  const salt = Buffer.from(saltRaw, 'base64url');
  const expected = Buffer.from(hashRaw, 'base64url');
  if (salt.length === 0 || expected.length === 0) {
    return false;
  }

  const actual = await deriveKey(password, salt, expected.length, n, r, p);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
