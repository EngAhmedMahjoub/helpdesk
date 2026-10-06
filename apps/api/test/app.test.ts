import { describe, expect, test } from 'bun:test'
import request from 'supertest'
import { createApp } from '../src/app.ts'

// Runs against the real test database (see .env.test), so the health check
// exercises an actual query rather than a stubbed one.
const app = createApp()

describe('GET /api/health', () => {
  test('reports the API and database as up', async () => {
    const res = await request(app).get('/api/health')

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(res.body.database).toBe('up')
  })
})

// #87. The limiter's tests prove what 3 does; these prove createApp applies it.
describe('trust proxy', () => {
  test('trusts no proxy unless told how many there are', () => {
    // .env.test sets no TRUST_PROXY_HOPS, so this is the default.
    expect(createApp().get('trust proxy')).toBe(0)
  })

  test('trusts the number of proxies it is given', () => {
    expect(createApp({ trustProxyHops: 3 }).get('trust proxy')).toBe(3)
  })
})

describe('unknown /api routes', () => {
  test('return a 404 JSON body', async () => {
    const res = await request(app).get('/api/does-not-exist')

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Not Found' })
  })
})

// From the Phase 7 security review (#258).
describe('response headers', () => {
  const paths = [
    ['a success', '/api/health', 200],
    ['an unauthenticated refusal', '/api/dashboard', 401],
    ['a 404', '/api/does-not-exist', 404],
  ] as const

  for (const [kind, path, status] of paths) {
    test(`${kind} does not name the framework and forbids sniffing`, async () => {
      const res = await request(app).get(path)

      expect(res.status).toBe(status)
      expect(res.headers['x-powered-by']).toBeUndefined()
      expect(res.headers['x-content-type-options']).toBe('nosniff')
    })
  }

  test('a malformed body answered by the error handler carries them too', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{not json')

    expect(res.status).toBe(400)
    expect(res.headers['x-powered-by']).toBeUndefined()
    expect(res.headers['x-content-type-options']).toBe('nosniff')
  })
})

describe('malformed requests', () => {
  /** Captures everything the handler writes, so the assertions can read it back. */
  function captureLogs() {
    const lines: string[] = []
    const original = { error: console.error, warn: console.warn }
    const record =
      (...prefix: unknown[]) =>
      (...args: unknown[]) =>
        void lines.push([...prefix, ...args].map((a) => Bun.inspect(a)).join(' '))

    console.error = record()
    console.warn = record()

    return {
      lines,
      restore() {
        console.error = original.error
        console.warn = original.warn
      },
    }
  }

  const secret = 'hunter2-should-never-be-logged'

  test('answers 400 for unparseable JSON without logging the body', async () => {
    const logs = captureLogs()
    try {
      const res = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        // Truncated mid-value, exactly as a cut-short request arrives.
        .send(`{"email":"agent@example.com","password":"${secret}"`)

      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'Bad Request' })
    } finally {
      logs.restore()
    }

    // express.json() hangs the raw body off the error; logging the error object
    // would put the submitted password in the log.
    expect(logs.lines.join('\n')).not.toContain(secret)
    expect(logs.lines.join('\n')).toContain('entity.parse.failed')
  })

  test('answers 413 for a body over the limit without logging it', async () => {
    const logs = captureLogs()
    try {
      const res = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ email: 'agent@example.com', password: secret.padEnd(200_000, 'x') }))

      expect(res.status).toBe(413)
      expect(res.body).toEqual({ error: 'Payload Too Large' })
    } finally {
      logs.restore()
    }

    expect(logs.lines.join('\n')).not.toContain(secret)
  })
})
