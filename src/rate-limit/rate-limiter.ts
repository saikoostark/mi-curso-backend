/**
 * A fixed-window rule: at most `limit` attempts per `windowSeconds`.
 */
export interface RateLimitRule {
  /** Attempts allowed inside the window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

/**
 * Port for rate limiting.
 *
 * Callers own their rules and hand in a pre-built key (namespace it per
 * flow/scope); the mechanism — a fixed window on the cache today, a sliding
 * window or a native limiter later — is swappable behind this abstraction.
 * `consume` records one attempt and rejects with HTTP 429 `rate_limited` once
 * the rule is exceeded; `clear` resets a counter (e.g. after a successful
 * login, so typos do not lock an account out for the rest of the window).
 */
export abstract class RateLimiter {
  /**
   * Records one attempt against a key and enforces the rule.
   *
   * @param key - Counter key (namespaced per flow/scope by the caller).
   * @param rule - Limit and window the counter is measured against.
   * @throws HttpException 429 `rate_limited` when the limit is exceeded.
   */
  abstract consume(key: string, rule: RateLimitRule): Promise<void>;

  /**
   * Clears the counter behind a key.
   *
   * @param key - Counter key.
   */
  abstract clear(key: string): Promise<void>;
}
