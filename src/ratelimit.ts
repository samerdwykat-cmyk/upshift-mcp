/**
 * Per-caller rate limiting, so a free public tool cannot be turned into a
 * free public crawler.
 *
 * A fixed window keyed by minute: cheap, one KV read and one write, and the
 * worst case an attacker gets is 2x the limit across a window boundary. That
 * trade is deliberate — a sliding log would cost a read of every prior hit
 * per call, and this endpoint is a shop window, not a payments API.
 */

export interface CounterStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts: { expirationTtl: number }): Promise<void>;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the current window rolls over. */
  retryAfterSec: number;
}

export const DEFAULT_LIMIT_PER_MIN = 20;

export async function checkRateLimit(
  store: CounterStore,
  caller: string,
  limit: number = DEFAULT_LIMIT_PER_MIN,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  const windowStart = Math.floor(now / 60_000);
  const key = `rl:${caller}:${windowStart}`;
  const used = Number((await store.get(key)) ?? 0);
  const retryAfterSec = 60 - Math.floor((now % 60_000) / 1000);

  if (used >= limit) {
    return { allowed: false, limit, remaining: 0, retryAfterSec };
  }
  // TTL of two windows so the key survives a boundary read without lingering.
  await store.put(key, String(used + 1), { expirationTtl: 120 });
  return { allowed: true, limit, remaining: limit - used - 1, retryAfterSec };
}

/** In-process store for local dev and tests — no KV needed. */
export class MemoryCounterStore implements CounterStore {
  private readonly map = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
}

/**
 * Who is calling. Cloudflare's CF-Connecting-IP is the only header here a
 * client cannot forge; the others are accepted only as a local-dev fallback.
 */
export function callerKey(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "anonymous"
  );
}
