/**
 * Port for key/value caching.
 *
 * Values are JSON-serializable (they are encoded/decoded transparently) and
 * TTLs are expressed in **milliseconds**, matching the JavaScript convention
 * used across the codebase. The concrete adapter is bound by `CacheModule`;
 * no consumer may reference it directly.
 */
export abstract class CacheService {
  /**
   * Round-trips the backend to prove connectivity.
   *
   * Used by the readiness probe; it must not mutate application data.
   */
  abstract ping(): Promise<void>;

  /**
   * Reads a key and decodes its JSON value.
   *
   * @param key - Cache key.
   * @returns The decoded value, or `null` when the key is absent/expired.
   */
  abstract get<T>(key: string): Promise<T | null>;

  /**
   * Stores a JSON-serializable value under a TTL.
   *
   * @param key - Cache key.
   * @param value - JSON-serializable value.
   * @param ttlMs - Time to live in milliseconds.
   */
  abstract set(key: string, value: unknown, ttlMs: number): Promise<void>;

  /**
   * Removes a key.
   *
   * @param key - Cache key.
   */
  abstract delete(key: string): Promise<void>;

  /**
   * Atomically increments a counter, applying the TTL when the counter is
   * first created (later increments keep the original TTL, so fixed windows
   * are never extended by activity).
   *
   * @param key - Cache key.
   * @param ttlMs - Time to live applied on creation, in milliseconds.
   * @returns The value after incrementing.
   */
  abstract increment(key: string, ttlMs: number): Promise<number>;

  /**
   * Reads the remaining TTL of a key.
   *
   * @param key - Cache key.
   * @returns Remaining milliseconds, or `null` when the key does not exist.
   */
  abstract ttlMs(key: string): Promise<number | null>;

  /**
   * Adds a member to a sorted set, scoring it by time, and (re)sets the key
   * TTL. Used for time-windowed membership such as the JTI denylist: members
   * expire by score, the whole key expires when idle.
   *
   * @param key - Cache key.
   * @param score - Numeric score (millisecond timestamps).
   * @param member - Member to add.
   * @param ttlMs - Time to live applied to the key.
   */
  abstract zadd(
    key: string,
    score: number,
    member: string,
    ttlMs: number,
  ): Promise<void>;

  /**
   * Reads a member's score.
   *
   * @param key - Cache key.
   * @param member - Member to look up.
   * @returns The score, or `null` when the member/key does not exist.
   */
  abstract zscore(key: string, member: string): Promise<number | null>;

  /**
   * Removes members whose score falls inside a range.
   *
   * @param key - Cache key.
   * @param min - Lower bound (`'-inf'` for none).
   * @param max - Upper bound (`'+inf'` for none).
   * @returns Number of removed members.
   */
  abstract zremRangeByScore(
    key: string,
    min: number | '-inf',
    max: number | '+inf',
  ): Promise<number>;

  /**
   * Counts the members of a sorted set.
   *
   * @param key - Cache key.
   * @returns The cardinality (0 when the key does not exist).
   */
  abstract zcard(key: string): Promise<number>;
}
