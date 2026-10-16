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
 * The IP half is only the client's when `trust proxy` counts the proxies in
 * front exactly: TRUST_PROXY_HOPS, 3 on Render (#87). Unset there, every client
 * would share one proxy's address and so one budget per account.
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
 * Caps `/api/auth/login` per IP alone, ahead of the per-account limit above.
 *
 * That limit gives each address its own budget, so one IP sending a new email
 * on every request was never refused — and each request still costs an argon2
 * verification at 64 MiB, against the dummy hash when no account exists (#326).
 * This bounds what one client can make the API hash, whichever accounts it names.
 *
 * Thirty in fifteen minutes is three accounts' worth of the per-account budget:
 * room for an office behind one NAT signing in at the start of a shift, and a
 * small fraction of the unbounded work it replaces.
 *
 * Production only, and behind the same trust-proxy setting, as the limit above.
 */
export function createLoginIpRateLimit(options: { skip?: boolean } = {}): RateLimitRequestHandler {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    skip: () => options.skip ?? false,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'unknown'),
    message: { error: 'Too many login attempts, please try again later' },
  })
}

export const loginIpRateLimit = createLoginIpRateLimit({ skip: env.NODE_ENV !== 'production' })

/**
 * A limiter keyed by whoever is acting, for the writes behind requireAuth.
 *
 * The IP fallback never fires there; it is what keeps a route wired without
 * the guard on a limit of its own rather than one bucket for everybody.
 *
 * Returns a factory, so each limit keeps its own name — and with it the comment
 * saying why that number and that message — and so the tests can build one that
 * enforces regardless of NODE_ENV.
 */
function perUserRateLimit(limit: number, message: string) {
  return (options: { skip?: boolean } = {}): RateLimitRequestHandler =>
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit,
      skip: () => options.skip ?? false,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? 'unknown'),
      message: { error: message },
    })
}

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
 * budget.
 *
 * Production only, like the login limit. The end-to-end suite creates and
 * deactivates users all day, and a live limit there would fail specs by order.
 */
export const createUserWriteRateLimit = perUserRateLimit(
  60,
  'Too many changes to users, please try again later',
)

export const userWriteRateLimit = createUserWriteRateLimit({
  skip: env.NODE_ENV !== 'production',
})

/**
 * Caps writes to a ticket — replies and changes alike — per acting user, on one
 * shared budget: both are the same agent working the same queue.
 *
 * A reply may carry 10,000 characters, and a thread is read back whole. One
 * agent session, stolen or scripted, could otherwise grow a single ticket until
 * every later read of it is expensive. A change is cheaper, but not free: since
 * the assignment lock it takes a locked read and a write each time. Higher than
 * the user-management limit: answering tickets is the job, and a busy agent
 * working through a queue should never meet this.
 *
 * Keyed and gated like the user-management limit: the acting user's id behind
 * requireAuth, and production only, so the end-to-end suite can work freely.
 */
export const createTicketWriteRateLimit = perUserRateLimit(
  120,
  'Too many changes to tickets, please try again later',
)

export const ticketWriteRateLimit = createTicketWriteRateLimit({
  skip: env.NODE_ENV !== 'production',
})

/**
 * Caps Polish (#323) per acting user. Every call is a billed model request, so
 * this is a bound on what one agent session, stolen or scripted, can spend:
 * at Haiku's prices and the 5,000-character input cap, about $0.01 a call.
 *
 * Thirty in fifteen minutes is a polish every thirty seconds — more than an
 * agent writing replies by hand will reach.
 *
 * Keyed and gated like the ticket-write limit: the acting user's id behind
 * requireAuth, and production only.
 */
export const createPolishRateLimit = perUserRateLimit(
  30,
  'Too many polish requests, please try again later',
)

export const polishRateLimit = createPolishRateLimit({
  skip: env.NODE_ENV !== 'production',
})

/**
 * Caps Polish across every user, per day. The per-user limit bounds one
 * account at about $35 a day; this bounds them all together, which nothing
 * else does — the ticket pipeline has AI_LIMITS.callsPerDay, Polish had no
 * counterpart.
 *
 * 1,000 is about $12 a day at the worst case of ~$0.012 a call (output at
 * the 2,048-token cap), and some ten times what a busy day of real use needs.
 *
 * One key for everybody, so it is a shared budget, not a per-caller one. In
 * memory like the others: a restart resets it and each instance counts on
 * its own, so the Anthropic Console's spend limit stays the hard cap.
 *
 * Production only, like the rest.
 */
export function createPolishDailyLimit(options: { skip?: boolean } = {}): RateLimitRequestHandler {
  return rateLimit({
    windowMs: 24 * 60 * 60 * 1000,
    limit: 1000,
    skip: () => options.skip ?? false,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: () => 'polish',
    message: { error: 'Polish has reached its daily limit, please try again tomorrow' },
  })
}

export const polishDailyLimit = createPolishDailyLimit({
  skip: env.NODE_ENV !== 'production',
})
