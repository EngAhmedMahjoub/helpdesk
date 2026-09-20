import { beforeEach, describe, expect, test } from 'bun:test'
import express from 'express'
import request from 'supertest'
import {
  createLoginRateLimit,
  createTicketWriteRateLimit,
  createUserWriteRateLimit,
} from '../src/auth/rate-limit.ts'

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

/**
 * Runs `source` in a fresh Bun process under `nodeEnv` and reports whether the
 * last status it printed was 429.
 */
async function lastStatusIs429(source: string, nodeEnv: string): Promise<boolean> {
  const proc = Bun.spawn(['bun', '-e', source], {
    // Inside apps/api so express resolves. Bun auto-loads the .env here, but
    // an explicit variable beats it, so the values below are what take effect.
    cwd: `${import.meta.dir}/..`,
    env: {
      PATH: process.env.PATH ?? '',
      NODE_ENV: nodeEnv,
      DATABASE_URL: 'postgresql://user:pw@localhost:5432/db',
      WEB_ORIGIN: 'https://app.example.com',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
  return stdout.trim().endsWith('429')
}

describe('which environments enforce it', () => {
  /**
   * Loads the module fresh under a chosen NODE_ENV and reports whether an
   * eleventh attempt is refused. A child process because the wiring is decided
   * once at import, from an env.ts that validates once and exits on failure —
   * neither can be re-evaluated inside the runner.
   */
  async function enforcesUnder(nodeEnv: string) {
    const source = `
      const { loginRateLimit } = await import(${JSON.stringify(`${import.meta.dir}/../src/auth/rate-limit.ts`)})
      const express = (await import('express')).default
      const app = express()
      app.use(express.json())
      app.post('/login', loginRateLimit, (_req, res) => res.status(401).end())
      const server = app.listen(0)
      const { port } = server.address()
      let last = 0
      for (let i = 0; i < 11; i += 1) {
        const res = await fetch(\`http://localhost:\${port}/login\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'agent@example.com', password: 'wrong' }),
        })
        last = res.status
      }
      server.close()
      console.log(String(last))
    `

    return lastStatusIs429(source, nodeEnv)
  }

  test('enforces in production', async () => {
    expect(await enforcesUnder('production')).toBe(true)
  })

  test('does not enforce in development', async () => {
    // It would only throttle whoever is building the screens that sign in.
    expect(await enforcesUnder('development')).toBe(false)
  })

  test('does not enforce in test', async () => {
    // A live limiter here would fail unrelated assertions by ordering.
    expect(await enforcesUnder('test')).toBe(false)
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
  /** As enforcesUnder above, for the users limiter: is a 61st write refused? */
  async function userWritesEnforcedUnder(nodeEnv: string) {
    const source = `
      const { userWriteRateLimit } = await import(${JSON.stringify(`${import.meta.dir}/../src/auth/rate-limit.ts`)})
      const express = (await import('express')).default
      const app = express()
      app.use((req, _res, next) => { req.user = { id: 'admin-1' }; next() })
      app.post('/users', userWriteRateLimit, (_req, res) => res.status(201).end())
      const server = app.listen(0)
      const { port } = server.address()
      let last = 0
      for (let i = 0; i < 61; i += 1) {
        last = (await fetch(\`http://localhost:\${port}/users\`, { method: 'POST' })).status
      }
      server.close()
      console.log(String(last))
    `

    return lastStatusIs429(source, nodeEnv)
  }

  test('enforces in production', async () => {
    expect(await userWritesEnforcedUnder('production')).toBe(true)
  })

  test('does not enforce in test, where the end-to-end suite creates users all day', async () => {
    expect(await userWritesEnforcedUnder('test')).toBe(false)
  })

  test('does not enforce in development', async () => {
    expect(await userWritesEnforcedUnder('development')).toBe(false)
  })
})

describe('ticket write limit', () => {
  /** A stand-in for POST /api/tickets/:id/replies behind an enforcing limiter. */
  function appWithTicketLimiter() {
    const app = express()
    app.use((req, _res, next) => {
      req.user = { id: String(req.headers['x-agent']), email: '', name: '', role: 'agent' }
      next()
    })
    app.post('/replies', createTicketWriteRateLimit(), (_req, res) => {
      res.status(201).end()
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
    expect(blocked.body).toEqual({ error: 'Too many replies, please try again later' })
  })

  test('budgets each agent separately, so a busy colleague costs nothing', async () => {
    const app = appWithTicketLimiter()
    for (let i = 0; i < 121; i += 1) await reply(app, 'agent-1')

    expect((await reply(app, 'agent-2')).status).toBe(201)
  })
})

describe('which environments enforce the ticket write limit', () => {
  /** As for the other two: a child process, since the wiring is read at import. */
  async function ticketRepliesEnforcedUnder(nodeEnv: string) {
    const source = `
      const { ticketWriteRateLimit } = await import(${JSON.stringify(`${import.meta.dir}/../src/auth/rate-limit.ts`)})
      const express = (await import('express')).default
      const app = express()
      app.use(express.json())
      app.post('/replies', ticketWriteRateLimit, (_req, res) => res.status(201).end())
      const server = app.listen(0)
      const { port } = server.address()
      let last = 0
      for (let i = 0; i < 121; i += 1) {
        last = (await fetch(\`http://localhost:\${port}/replies\`, { method: 'POST' })).status
      }
      server.close()
      console.log(String(last))
    `

    return lastStatusIs429(source, nodeEnv)
  }

  test('enforces in production', async () => {
    expect(await ticketRepliesEnforcedUnder('production')).toBe(true)
  })

  test('does not enforce in development', async () => {
    expect(await ticketRepliesEnforcedUnder('development')).toBe(false)
  })
})
