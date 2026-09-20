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
 * Enforced in production only. It exists to blunt an endpoint facing the open
 * internet; locally it only throttles the person building the screens that sign
 * in, and in the test suite a live limiter would fail unrelated assertions by
 * ordering. Gating on NODE_ENV is safe now that it has no default — a
 * production deploy that omits it refuses to boot rather than starting with
 * this quietly off.
 *
 * A factory, so the limiter's own tests can build one that enforces regardless.
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

export const loginRateLimit = createLoginRateLimit({ skip: env.NODE_ENV !== 'production' })

/**
 * Caps user-management writes — creating agents and switching them on or off —
 * per admin.
 *
 * Every create hashes a password at argon2's 64 MiB before the unique index is
 * even asked, so a duplicate that ends in 409 costs as much as a success. One
 * admin session, stolen or scripted, could otherwise keep the API busy hashing.
 *
 * Keyed by the admin's id rather than IP: requireAuth has already run, so the
 * caller is known, and a busy office sharing one address should not share one
 * budget. The IP fallback never fires behind requireAuth; it is there so a
 * route wired without it still gets a limit instead of a shared bucket.
 *
 * Production only, like the login limit. The end-to-end suite creates and
 * deactivates users all day, and a live limit there would fail specs by order.
 */
export function createUserWriteRateLimit(
  options: { skip?: boolean } = {},
): RateLimitRequestHandler {
  const { skip = false } = options

  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    skip: () => skip,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? 'unknown'),
    message: { error: 'Too many changes to users, please try again later' },
  })
}

export const userWriteRateLimit = createUserWriteRateLimit({
  skip: env.NODE_ENV !== 'production',
})

/**
 * Caps writes to a ticket — replies today, and whatever else agents post to one
 * later — per acting user.
 *
 * A reply may carry 10,000 characters, and a thread is read back whole. One
 * agent session, stolen or scripted, could otherwise grow a single ticket until
 * every later read of it is expensive. Higher than the user-management limit:
 * answering tickets is the job, and a busy agent working through a queue should
 * never meet this.
 *
 * Keyed and gated like the user-management limit: the acting user's id behind
 * requireAuth, and production only, so the end-to-end suite can reply freely.
 */
export function createTicketWriteRateLimit(
  options: { skip?: boolean } = {},
): RateLimitRequestHandler {
  const { skip = false } = options

  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 120,
    skip: () => skip,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? 'unknown'),
    message: { error: 'Too many replies, please try again later' },
  })
}

export const ticketWriteRateLimit = createTicketWriteRateLimit({
  skip: env.NODE_ENV !== 'production',
})
