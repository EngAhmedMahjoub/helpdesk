import { describe, expect, test } from 'bun:test'
import { VALID_BOOT_ENV } from './boot-env.ts'

type CookieRoundTrip = { set: string; cleared: string; read: string | null }

/**
 * Sets, clears and reads the session cookie with session.ts loaded fresh under
 * `nodeEnv`. A child process, as for the rate limits: the name is fixed once
 * at import, from an env.ts that validates once, so the runner's own NODE_ENV
 * cannot be swapped for production inside it.
 *
 * No database: setting and clearing only write headers, and reading only
 * parses one.
 */
async function roundTripUnder(nodeEnv: string): Promise<CookieRoundTrip> {
  const source = `
    const { SESSION_COOKIE, clearSessionCookie, readSessionToken, setSessionCookie } = await import(${JSON.stringify(`${import.meta.dir}/../src/auth/session.ts`)})
    const express = (await import('express')).default
    const cookieParser = (await import('cookie-parser')).default
    const app = express()
    app.use(cookieParser())
    app.get('/set', (_req, res) => { setSessionCookie(res, 'tok'); res.end() })
    app.get('/clear', (_req, res) => { clearSessionCookie(res); res.end() })
    app.get('/read', (req, res) => res.json({ token: readSessionToken(req) ?? null }))
    const server = app.listen(0)
    const base = \`http://localhost:\${server.address().port}\`
    const set = (await fetch(\`\${base}/set\`)).headers.get('set-cookie')
    const cleared = (await fetch(\`\${base}/clear\`)).headers.get('set-cookie')
    const read = await (await fetch(\`\${base}/read\`, { headers: { Cookie: \`\${SESSION_COOKIE}=tok\` } })).json()
    server.close()
    console.log(JSON.stringify({ set, cleared, read: read.token }))
  `
  // --no-env-file, as in rate-limit.test.ts: the child sees this environment only.
  const proc = Bun.spawn(['bun', '--no-env-file', '-e', source], {
    cwd: `${import.meta.dir}/..`,
    env: { PATH: process.env.PATH ?? '', ...VALID_BOOT_ENV, NODE_ENV: nodeEnv },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exitCode !== 0)
    throw new Error(`The ${nodeEnv} child failed (exit ${String(exitCode)}):\n${stderr}`)
  return JSON.parse(stdout.trim().split('\n').at(-1)!) as CookieRoundTrip
}

describe('the session cookie in production (#329)', () => {
  test('is set as __Host-session, Secure, on path / and with no Domain', async () => {
    const { set } = await roundTripUnder('production')

    expect(set).toStartWith('__Host-session=tok;')
    expect(set).toContain('Path=/')
    expect(set).toContain('Secure')
    expect(set).toContain('HttpOnly')
    // A Domain attribute would make the browser refuse a __Host- cookie.
    expect(set.toLowerCase()).not.toContain('domain=')
  })

  test('is cleared under the same name, so logout removes it', async () => {
    const { cleared } = await roundTripUnder('production')

    expect(cleared).toStartWith('__Host-session=;')
    expect(cleared).toContain('Expires=Thu, 01 Jan 1970')
  })

  test('is read back by that name', async () => {
    expect((await roundTripUnder('production')).read).toBe('tok')
  })
})

describe('the session cookie in development', () => {
  test('keeps the plain name, since __Host- needs Secure and development is HTTP', async () => {
    const { set, read } = await roundTripUnder('development')

    expect(set).toStartWith('session=tok;')
    expect(set).not.toContain('Secure')
    expect(read).toBe('tok')
  })
})
