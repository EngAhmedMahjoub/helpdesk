import { type RateLimitRequestHandler, ipKeyGenerator, rateLimit } from 'express-rate-limit'
import { env } from '../env.ts'

/**
 * Caps password guessing against `/api/auth/login`.
 *
 * Keyed by IP *and* submitted address, so an attacker working through a list of
 * accounts is throttled per account rather than earning a fresh budget for each,
 * and a shared office NAT cannot lock a colleague out by exhausting a per-IP
 * count on their own login.
 *
 * Counts every attempt, successful or not. Skipping successes would let an
 * attacker who already holds one valid credential keep their budget topped up.
 *
 * A factory, so a test can build one that enforces while the suite's own runs
 * with `skip` on — the suite makes many logins in quick succession from one
 * address, and a live limiter would fail unrelated assertions by ordering.
 *
 * Production note: Koyeb puts a proxy in front of the API, so `req.ip` will be
 * the proxy's until `trust proxy` is configured. Until then the IP half of the
 * key is constant and only the address half discriminates. Task 8.5 should set
 * it to the exact number of proxies — `true` would let anyone spoof their key
 * with an X-Forwarded-For header.
 */
export function createLoginRateLimit(options: { skip?: boolean } = {}): RateLimitRequestHandler {
  const { skip = false } = options

  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    skip: () => skip,
    // The standard RateLimit-* headers; the legacy X-RateLimit-* ones are noise.
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => {
      const email: unknown = (req.body as { email?: unknown } | undefined)?.email
      // ipKeyGenerator masks an IPv6 address to its subnet, so an attacker
      // holding a /64 cannot sidestep the count by rotating the low bits.
      const ip = ipKeyGenerator(req.ip ?? 'unknown')
      return typeof email === 'string' ? `${ip}:${email.toLowerCase()}` : ip
    },
    message: { error: 'Too many login attempts, please try again later' },
  })
}

export const loginRateLimit = createLoginRateLimit({ skip: env.NODE_ENV === 'test' })
