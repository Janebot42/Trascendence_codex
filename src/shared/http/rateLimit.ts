import { tooManyRequests } from '../errors/httpErrors.js';

type Bucket = {
  attempts: number;
  resetAt: number;
};

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly maxAttempts: number,
    private readonly windowMs: number
  ) {}

  assertAllowed(key: string): void {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { attempts: 1, resetAt: now + this.windowMs });
      return;
    }

    bucket.attempts += 1;
    if (bucket.attempts > this.maxAttempts) {
      throw tooManyRequests();
    }
  }
}

