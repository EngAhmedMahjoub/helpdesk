import { describe, expect, test } from 'bun:test'

/**
 * Loads src/env.ts in a fresh process with a chosen environment, and reports
 * whether it accepted it. A child process is the only honest way to test this:
 * the module validates once at import and calls process.exit on failure, so it
 * cannot be re-imported with different values inside the test runner.
 */
async function bootWith(env: Record<string, string | undefined>) {
  const envModule = `${import.meta.dir}/../src/env.ts`
  const proc = Bun.spawn(['bun', '-e', `await import(${JSON.stringify(envModule)})`], {
    // Run outside apps/api: Bun auto-loads the .env in its working directory,
    // which would supply the very value the test is withholding.
    cwd: '/',
    // Nothing but PATH, so only what the test passes is visible.
    env: { PATH: process.env.PATH ?? '', ...env } as Record<string, string>,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()])
  return { exitCode, stderr }
}

const valid = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:pw@localhost:5432/db',
  WEB_ORIGIN: 'https://app.example.com',
}

describe('environment validation', () => {
  test('accepts a complete environment', async () => {
    const { exitCode } = await bootWith(valid)

    expect(exitCode).toBe(0)
  })

  test('refuses to boot without NODE_ENV', async () => {
    // No default on purpose: NODE_ENV gates the Secure flag on the session
    // cookie, so a deploy that forgets it must fail loudly rather than serve a
    // cookie usable over plain HTTP.
    const { exitCode, stderr } = await bootWith({ ...valid, NODE_ENV: undefined })

    expect(exitCode).not.toBe(0)
    expect(stderr).toContain('NODE_ENV')
  })

  test('refuses to boot without WEB_ORIGIN', async () => {
    // Likewise: defaulting this would let production trust a localhost origin.
    const { exitCode, stderr } = await bootWith({ ...valid, WEB_ORIGIN: undefined })

    expect(exitCode).not.toBe(0)
    expect(stderr).toContain('WEB_ORIGIN')
  })

  test('refuses to boot without DATABASE_URL', async () => {
    const { exitCode, stderr } = await bootWith({ ...valid, DATABASE_URL: undefined })

    expect(exitCode).not.toBe(0)
    expect(stderr).toContain('DATABASE_URL')
  })
})
