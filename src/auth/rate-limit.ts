interface Bucket {
  count: number;
  windowStart: number;
  lockedUntil: number;
}

export interface AuthRateConfig {
  maxAttempts: number;
  windowMs: number;
  lockoutMs: number;
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw == null || !raw.trim()) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

/** Defaults: 10 failures, 15 minute window, 15 minute lockout. */
export function readAuthRateConfig(): AuthRateConfig {
  const maxAttempts = intEnv("SKILL_FLOW_AUTH_MAX_ATTEMPTS", 10, 1, 100);
  const windowSec = intEnv("SKILL_FLOW_AUTH_WINDOW_SEC", 900, 1, 86_400);
  const lockoutSec = intEnv("SKILL_FLOW_AUTH_LOCKOUT_SEC", 900, 1, 86_400);
  return {
    maxAttempts,
    windowMs: windowSec * 1000,
    lockoutMs: lockoutSec * 1000,
  };
}

/**
 * In-memory failure lockout for login and setup.
 * A hit counts against both the client IP and the account.
 * The process restart clears it.
 */
export class AuthRateLimiter {
  private readonly ips = new Map<string, Bucket>();
  private readonly accounts = new Map<string, Bucket>();

  constructor(
    private readonly maxAttempts: number,
    private readonly windowMs: number,
    private readonly lockoutMs: number,
  ) {}

  /** Seconds until the caller may try again, or 0 if not locked. */
  retryAfterSec(ip: string, account: string, now = Date.now()): number {
    return this.retry(Math.max(this.lockedUntil(this.ips, ip), this.lockedUntil(this.accounts, account)), now);
  }

  /**
   * Record a failed attempt. Returns Retry-After seconds when this
   * failure starts or extends a lockout, otherwise 0.
   */
  fail(ip: string, account: string, now = Date.now()): number {
    const ipBucket = this.touch(this.ips, ip, now);
    const accountBucket = this.touch(this.accounts, account, now);
    if (ipBucket.lockedUntil > now || accountBucket.lockedUntil > now) {
      return this.retryAfterSec(ip, account, now);
    }
    ipBucket.count += 1;
    accountBucket.count += 1;
    if (ipBucket.count >= this.maxAttempts) ipBucket.lockedUntil = now + this.lockoutMs;
    if (accountBucket.count >= this.maxAttempts) {
      accountBucket.lockedUntil = now + this.lockoutMs;
    }
    this.prune(this.ips, now);
    this.prune(this.accounts, now);
    return this.retryAfterSec(ip, account, now);
  }

  /** Clear the account bucket after a successful login or setup. */
  success(account: string): void {
    this.accounts.delete(account);
  }

  private lockedUntil(map: Map<string, Bucket>, key: string): number {
    return map.get(key)?.lockedUntil ?? 0;
  }

  private retry(until: number, now: number): number {
    if (until <= now) return 0;
    return Math.max(1, Math.ceil((until - now) / 1000));
  }

  private touch(map: Map<string, Bucket>, key: string, now: number): Bucket {
    let bucket = map.get(key);
    if (!bucket) {
      bucket = { count: 0, windowStart: now, lockedUntil: 0 };
      map.set(key, bucket);
      return bucket;
    }
    if (bucket.lockedUntil > now) return bucket;
    if (now - bucket.windowStart >= this.windowMs) {
      bucket.count = 0;
      bucket.windowStart = now;
      bucket.lockedUntil = 0;
    }
    return bucket;
  }

  private prune(map: Map<string, Bucket>, now: number): void {
    if (map.size <= 2000) return;
    for (const [key, bucket] of map) {
      if (bucket.lockedUntil <= now && now - bucket.windowStart >= this.windowMs) {
        map.delete(key);
      }
    }
  }
}
