import { ApiError } from './http.js';

// In-process sliding-window limiter. Suitable for a single instance; a
// multi-node deployment should swap this for Redis or an edge limiter.
const buckets = new Map();

export function rateLimit({ scope, limit = 60, windowMs = 60_000, keyFn = (req) => req.ip } = {}) {
  return (req, _res, next) => {
    const key = `${scope}:${keyFn(req) || 'anonymous'}`;
    const now = Date.now();
    const hits = (buckets.get(key) || []).filter((ts) => ts > now - windowMs);
    if (hits.length >= limit) {
      const retryAfter = Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000));
      return next(new ApiError(429, `Too many requests. Try again in ${retryAfter}s`, 'rate_limited'));
    }
    hits.push(now);
    buckets.set(key, hits);
    if (buckets.size > 5000) {
      for (const [bucketKey, values] of buckets) {
        if (values.every((ts) => ts <= now - windowMs)) buckets.delete(bucketKey);
      }
    }
    return next();
  };
}

export function clearRateLimits() {
  buckets.clear();
}
