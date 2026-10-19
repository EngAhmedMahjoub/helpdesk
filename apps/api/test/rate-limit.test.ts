import { beforeEach, describe, expect, test } from 'bun:test'
import express from 'express'
import request from 'supertest'
import {
  createLoginIpRateLimit,
  createLoginRateLimit,
  createPolishDailyLimit,
  createPolishRateLimit,
  createTicketWriteRateLimit,
  createUserWriteRateLimit,
} from '../src/auth/rate-limit.ts'
import { runUnder } from './child-process.ts'

/**
 * A stand-in for the login route, carrying a limiter that actually enforces.
 * The app's own limiter is skipped under NODE_ENV=test so the rest of the suite
 * can log in freely; this builds one deliberately enabled to test its config.
 */
function appWithLimiter() {
  const app = express()
  app.use(express.json())
  app.post('/api/auth/login', createLoginRateLimit(), (_req, res) => {
    res.status(401).json({ error: 'Invalid email or password' })
  })
  return app
}

let app: ReturnType<typeof appWithLimiter>

beforeEach(() => {
  app = appWithLimiter()
})

const attempt = (email: string) =>
  request(app).post('/api/auth/login').send({ email, password: 'wrong password' })

describe('login rate limit', () => {
  test('refuses further attempts once the budget is spent', async () => {
    for (let i = 0; i < 10; i += 1) {
      expect((await attempt('agent@example.com')).status).toBe(401)
    }

    const blocked = await attempt('agent@example.com')

    expect(blocked.status).toBe(429)
    expect(blocked.body).toEqual({ error: 'Too many login attempts, please try again later' })
  })

  test('budgets each address separately, so one target cannot exhaust another', async () => {
    for (let i = 0; i < 11; i += 1) await attempt('first@example.com')

    // A colleague behind the same NAT must still be able to sign in.
    const other = await attempt('second@example.com')

    expect(other.status).toBe(401)
  })

  test('counts case-insensitively, so changing the casing buys no extra attempts', async () => {
    for (let i = 0; i < 10; i += 1) await attempt('agent@example.com')

    const shouted = await attempt('AGENT@EXAMPLE.COM')

    expect(shouted.status).toBe(429)
  })

  test('advertises the remaining budget', async () => {
    const res = await attempt('agent@example.com')

    expect(res.headers['ratelimit']).toContain('remaining=9')
  })
})

describe('login per-IP limit', () => {
  /** The login stand-in behind both limits, in the route's order. */
  function appWithBothLimiters() {
    const both = express()
    both.use(express.json())
    both.post('/api/auth/login', createLoginIpRateLimit(), createLoginRateLimit(), (_req, res) => {
      res.status(401).json({ error: 'Invalid email or password' })
    })
    return both
  }

  const attemptOn = (target: ReturnType<typeof appWithBothLimiters>, email: string) =>
    request(target).post('/api/auth/login').send({ email, password: 'wrong password' })

  test('refuses one IP that names a new address on every attempt', async () => {
    const both = appWithBothLimiters()
    // Each address is fresh to the per-account limit, so only the IP limit counts.
    for (let i = 0; i < 30; i += 1) {
      expect((await attemptOn(both, `agent-${String(i)}@example.com`)).status).toBe(401)
    }

    const blocked = await attemptOn(both, 'agent-30@example.com')

    expect(blocked.status).toBe(429)
    expect(blocked.body).toEqual({ error: 'Too many login attempts, please try again later' })
  })

  test('leaves the per-account limit first to refuse a single account', async () => {
    const both = appWithBothLimiters()
    for (let i = 0; i < 10; i += 1) await attemptOn(both, 'agent@example.com')

    expect((await attemptOn(both, 'agent@example.com')).status).toBe(429)
    // That account is spent, but the IP has budget left for a colleague.
    expect((await attemptOn(both, 'colleague@example.com')).status).toBe(401)
  })
})

/**
 * The limiter behind Render's three proxies (#87), as measured there: each
 * request reaches the app with `X-Forwarded-For: <client>, <Cloudflare>,
 * <Render's balancer>` from a proxy on localhost, which supertest's own socket
 * stands in for.
 */
describe('behind three proxies', () => {
  function appBehindProxies() {
    const proxied = appWithLimiter()
    proxied.set('trust proxy', 3)
    return proxied
  }

  const viaProxies = (target: ReturnType<typeof appWithLimiter>, xff: string) =>
    request(target)
      .post('/api/auth/login')
      .set('X-Forwarded-For', `${xff}, 172.70.251.12, 10.196.1.145`)
      .send({ email: 'agent@example.com', password: 'wrong password' })

  test('a client cannot reset its budget by writing its own X-Forwarded-For', async () => {
    const proxied = appBehindProxies()
    // A fresh made-up entry ahead of the real address on every attempt: were it
    // believed, each would key a new budget.
    for (let i = 0; i < 10; i += 1) {
      expect((await viaProxies(proxied, `203.0.113.${String(i)}, 198.51.100.1`)).status).toBe(401)
    }

    const blocked = await viaProxies(proxied, '203.0.113.99, 198.51.100.1')

    expect(blocked.status).toBe(429)
  })

  test('two clients behind the same proxies keep separate budgets', async () => {
    const proxied = appBehindProxies()
    for (let i = 0; i < 11; i += 1) await viaProxies(proxied, '198.51.100.1')

    // Same account, another client: the proxies' addresses are not the key.
    const other = await viaProxies(proxied, '198.51.100.2')

    expect(other.status).toBe(401)
  })
})

/**
 * Runs `source` in a fresh Bun process under `nodeEnv` and reports whether the
 * last status it printed was 429.
 *
 * Throws when the process did not get as far as printing one. Returning false
 * then would pass every "does not enforce" case without the limiter ever
 * running, which is how a variable newly required at boot once went unnoticed.
 */
async function lastStatusIs429(source: string, nodeEnv: string): Promise<boolean> {
  const { stdout, stderr, exitCode } = await runUnder(nodeEnv, source)
  const status = /(\d{3})\s*$/.exec(stdout)?.[1]
  if (exitCode !== 0 || !status) {
    throw new Error(`The ${nodeEnv} child printed no status (exit ${String(exitCode)}):\n${stderr}`)
  }
  return status === '429'
}

/**
 * Loads rate-limit.ts fresh under a chosen NODE_ENV, mounts the exported
 * `limiter` instance, sends it `requests` POSTs and reports whether the last
 * was refused. A child process because the wiring is decided once at import.
 *
 * `userId` stands in for requireAuth's req.user. `body` is a JavaScript
 * expression evaluated in the child for each request, with the loop's `i` in
 * scope, and sent as JSON; without it the requests carry no body.
 */
async function enforcedUnder(
  nodeEnv: string,
  options: { limiter: string; requests: number; userId?: string; body?: string },
): Promise<boolean> {
  const { limiter, requests, userId, body } = options
  const actAs = userId
    ? `app.use((req, _res, next) => { req.user = { id: ${JSON.stringify(userId)} }; next() })`
    : ''
  const init = body
    ? `{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(${body}) }`
    : `{ method: 'POST' }`
  const source = `
    const { ${limiter} } = await import(${JSON.stringify(`${import.meta.dir}/../src/auth/rate-limit.ts`)})
    const express = (await import('express')).default
    const app = express()
    app.use(express.json())
    ${actAs}
    app.post('/', ${limiter}, (_req, res) => res.status(200).end())
    const server = app.listen(0)
    const { port } = server.address()
    let last = 0
    for (let i = 0; i < ${String(requests)}; i += 1) {
      last = (await fetch(\`http://localhost:\${port}/\`, ${init})).status
    }
    server.close()
    console.log(String(last))
  `

  return lastStatusIs429(source, nodeEnv)
}

describe('which environments enforce it', () => {
  // Is an eleventh attempt at one address refused?
  const login = {
    limiter: 'loginRateLimit',
    requests: 11,
    body: `{ email: 'agent@example.com', password: 'wrong' }`,
  }

  test('enforces in production', async () => {
    expect(await enforcedUnder('production', login)).toBe(true)
  })

  test('does not enforce in development', async () => {
    // It would only throttle whoever is building the screens that sign in.
    expect(await enforcedUnder('development', login)).toBe(false)
  })

  test('does not enforce in test', async () => {
    // A live limiter here would fail unrelated assertions by ordering.
    expect(await enforcedUnder('test', login)).toBe(false)
  })
})

describe('which environments enforce the login per-IP limit', () => {
  // Is a 31st attempt, each naming a new address, refused?
  const loginIp = {
    limiter: 'loginIpRateLimit',
    requests: 31,
    body: "{ email: `agent-${i}@example.com`, password: 'wrong' }",
  }

  test('enforces in production', async () => {
    expect(await enforcedUnder('production', loginIp)).toBe(true)
  })

  test('does not enforce in test', async () => {
    expect(await enforcedUnder('test', loginIp)).toBe(false)
  })
})

describe('user-management write limit', () => {
  /**
   * A stand-in for POST /api/users behind an enforcing limiter. The caller is
   * named by a header here, standing in for the requireAuth that sets req.user
   * in the real route.
   */
  function appWithUserLimiter() {
    const app = express()
    app.use((req, _res, next) => {
      req.user = { id: String(req.headers['x-admin']), email: '', name: '', role: 'admin' }
      next()
    })
    app.post('/api/users', createUserWriteRateLimit(), (_req, res) => {
      res.status(201).end()
    })
    return app
  }

  const create = (app: ReturnType<typeof appWithUserLimiter>, admin: string) =>
    request(app).post('/api/users').set('x-admin', admin)

  test('refuses an admin further writes once their budget is spent', async () => {
    const app = appWithUserLimiter()
    for (let i = 0; i < 60; i += 1) {
      expect((await create(app, 'admin-1')).status).toBe(201)
    }

    const blocked = await create(app, 'admin-1')

    expect(blocked.status).toBe(429)
    expect(blocked.body).toEqual({ error: 'Too many changes to users, please try again later' })
  })

  test('budgets each admin separately', async () => {
    const app = appWithUserLimiter()
    for (let i = 0; i < 61; i += 1) await create(app, 'admin-1')

    // Keyed by who is asking, not where from: another admin is unaffected.
    expect((await create(app, 'admin-2')).status).toBe(201)
  })
})

describe('which environments enforce the user-management write limit', () => {
  // Is one admin's 61st write refused?
  const userWrites = { limiter: 'userWriteRateLimit', requests: 61, userId: 'admin-1' }

  test('enforces in production', async () => {
    expect(await enforcedUnder('production', userWrites)).toBe(true)
  })

  test('does not enforce in test, where the end-to-end suite creates users all day', async () => {
    expect(await enforcedUnder('test', userWrites)).toBe(false)
  })

  test('does not enforce in development', async () => {
    expect(await enforcedUnder('development', userWrites)).toBe(false)
  })
})

describe('ticket write limit', () => {
  /**
   * Stand-ins for the two ticket writes behind one enforcing limiter, mounted
   * the way the router mounts it: a single instance, so both draw on one budget.
   */
  function appWithTicketLimiter() {
    const app = express()
    app.use((req, _res, next) => {
      req.user = { id: String(req.headers['x-agent']), email: '', name: '', role: 'agent' }
      next()
    })
    const limiter = createTicketWriteRateLimit()
    app.post('/replies', limiter, (_req, res) => {
      res.status(201).end()
    })
    app.patch('/tickets/1', limiter, (_req, res) => {
      res.status(200).end()
    })
    return app
  }

  const reply = (app: ReturnType<typeof appWithTicketLimiter>, agent: string) =>
    request(app).post('/replies').set('x-agent', agent)

  test('refuses an agent further replies once their budget is spent', async () => {
    const app = appWithTicketLimiter()
    for (let i = 0; i < 120; i += 1) {
      expect((await reply(app, 'agent-1')).status).toBe(201)
    }

    const blocked = await reply(app, 'agent-1')

    expect(blocked.status).toBe(429)
    expect(blocked.body).toEqual({ error: 'Too many changes to tickets, please try again later' })
  })

  test('refuses a change once the budget is spent, and never reaches the handler', async () => {
    const app = appWithTicketLimiter()
    let changed = 0
    const change = (agent: string) =>
      request(app)
        .patch('/tickets/1')
        .set('x-agent', agent)
        .then((res) => {
          if (res.status === 200) changed += 1
          return res
        })

    for (let i = 0; i < 120; i += 1) {
      expect((await change('agent-1')).status).toBe(200)
    }

    const blocked = await change('agent-1')

    expect(blocked.status).toBe(429)
    // The handler that would write the ticket never ran on the refused request.
    expect(changed).toBe(120)
  })

  test('replies and changes share one budget, since one agent makes both', async () => {
    const app = appWithTicketLimiter()
    for (let i = 0; i < 120; i += 1) await reply(app, 'agent-1')

    const blocked = await request(app).patch('/tickets/1').set('x-agent', 'agent-1')

    expect(blocked.status).toBe(429)
  })

  test('budgets each agent separately, so a busy colleague costs nothing', async () => {
    const app = appWithTicketLimiter()
    for (let i = 0; i < 121; i += 1) await reply(app, 'agent-1')

    expect((await reply(app, 'agent-2')).status).toBe(201)
  })
})

describe('which environments enforce the ticket write limit', () => {
  // Is a 121st reply refused?
  const ticketWrites = { limiter: 'ticketWriteRateLimit', requests: 121 }

  test('enforces in production', async () => {
    expect(await enforcedUnder('production', ticketWrites)).toBe(true)
  })

  test('does not enforce in development', async () => {
    expect(await enforcedUnder('development', ticketWrites)).toBe(false)
  })
})

describe('polish limit', () => {
  /** A stand-in for POST /api/ai/polish behind an enforcing limiter, as for the others. */
  function appWithPolishLimiter() {
    const app = express()
    app.use((req, _res, next) => {
      req.user = { id: String(req.headers['x-agent']), email: '', name: '', role: 'agent' }
      next()
    })
    app.post('/polish', createPolishRateLimit(), (_req, res) => {
      res.status(200).end()
    })
    return app
  }

  const polish = (app: ReturnType<typeof appWithPolishLimiter>, agent: string) =>
    request(app).post('/polish').set('x-agent', agent)

  test('refuses an agent further polishes once their budget is spent', async () => {
    const app = appWithPolishLimiter()
    for (let i = 0; i < 30; i += 1) {
      expect((await polish(app, 'agent-1')).status).toBe(200)
    }

    const blocked = await polish(app, 'agent-1')

    expect(blocked.status).toBe(429)
    expect(blocked.body).toEqual({ error: 'Too many polish requests, please try again later' })
  })

  test('budgets each agent separately', async () => {
    const app = appWithPolishLimiter()
    for (let i = 0; i < 31; i += 1) await polish(app, 'agent-1')

    expect((await polish(app, 'agent-2')).status).toBe(200)
  })
})

describe('which environments enforce the polish limit', () => {
  // Is one agent's 31st polish refused?
  const polish = { limiter: 'polishRateLimit', requests: 31, userId: 'agent-1' }

  test('enforces in production', async () => {
    expect(await enforcedUnder('production', polish)).toBe(true)
  })

  test('does not enforce in test', async () => {
    expect(await enforcedUnder('test', polish)).toBe(false)
  })
})

describe('polish daily limit', () => {
  /** A stand-in for POST /api/ai/polish behind both limits, in the route's order. */
  function appWithPolishLimits() {
    const app = express()
    app.use((req, _res, next) => {
      req.user = { id: String(req.headers['x-agent']), email: '', name: '', role: 'agent' }
      next()
    })
    app.post('/polish', createPolishRateLimit(), createPolishDailyLimit(), (_req, res) => {
      res.status(200).end()
    })
    return app
  }

  const polish = (app: ReturnType<typeof appWithPolishLimits>, agent: string) =>
    request(app).post('/polish').set('x-agent', agent)

  test('refuses everybody once all users together have spent the day', async () => {
    const app = appWithPolishLimits()
    // 34 agents at 30 each stay inside their own limits and spend 1,020 in all.
    let ok = 0
    for (let agent = 0; agent < 34; agent += 1) {
      for (let i = 0; i < 30; i += 1) {
        if ((await polish(app, `agent-${String(agent)}`)).status === 200) ok += 1
      }
    }
    expect(ok).toBe(1000)

    const blocked = await polish(app, 'agent-fresh')

    expect(blocked.status).toBe(429)
    expect(blocked.body).toEqual({
      error: 'Polish has reached its daily limit, please try again tomorrow',
    })
    // A thousand requests are the point, and take seconds under a loaded suite.
  }, 30_000)

  test('a request one user is refused for spends none of the shared budget', async () => {
    const app = appWithPolishLimits()
    // Ten past agent-1's own limit, each refused before the daily count.
    for (let i = 0; i < 40; i += 1) await polish(app, 'agent-1')

    // agent-1 spent 30 of the day's 1,000; 970 remain for everybody else.
    const other = await polish(app, 'agent-2')

    expect(other.status).toBe(200)
    expect(other.headers['ratelimit']).toContain('remaining=969')
  })
})

describe('which environments enforce the polish daily limit', () => {
  // Is the 1,001st polish of the day refused? One key for everybody, so no user.
  const daily = { limiter: 'polishDailyLimit', requests: 1001 }

  test('enforces in production', async () => {
    expect(await enforcedUnder('production', daily)).toBe(true)
  })

  test('does not enforce in test', async () => {
    expect(await enforcedUnder('test', daily)).toBe(false)
  })
})
