import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { env } from './env.js';

/**
 * We keep two Redis clients: one for publishing (and normal commands) and one
 * dedicated to subscription (once a client subscribes, it cannot issue regular
 * commands until it unsubscribes).
 */
export const pub = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
export const sub = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });

export const INSTANCE_ID = env.INSTANCE_ID || randomUUID();

// Lua script for a Redis-backed sliding-window rate limiter. Atomic check-and-incr.
//
//   KEYS[1] = user bucket key (eg. `ratelimit:run:<userId>`)
//   ARGV[1] = max events
//   ARGV[2] = window in milliseconds
//   ARGV[3] = current timestamp (ms)
//
// Returns 1 (allowed) or 0 (denied) plus the retry-after hint in seconds.
const RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local max = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count >= max then
  local oldest = tonumber(redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')[2])
  local retry_after = math.ceil((oldest + window - now) / 1000)
  return {0, retry_after}
end
redis.call('ZADD', key, now, now .. ':' .. redis.call('INCR', 'ratelimit:seq'))
redis.call('PEXPIRE', key, window)
return {1, 0}
`;

let rateLimitSha: string | null = null;

async function ensureRateLimitScript(): Promise<string> {
  if (rateLimitSha) return rateLimitSha;
  rateLimitSha = (await pub.script('LOAD', RATE_LIMIT_SCRIPT)) as string;
  return rateLimitSha;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
}

export async function checkRateLimit(
  bucket: string,
  max: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const sha = await ensureRateLimitScript();
  const res = (await pub.evalsha(
    sha,
    1,
    bucket,
    String(max),
    String(windowMs),
    String(Date.now()),
  )) as [number, number];
  return { allowed: res[0] === 1, retryAfterSec: res[1] };
}
