import { afterEach, expect, test } from 'bun:test'
import { ApiError, apiFetch } from '../src/lib/api.ts'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

/** Captures the arguments of the single fetch the call under test makes. */
function stubFetch(response: Response) {
  const calls: { url: string; init: RequestInit | undefined }[] = []
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return Promise.resolve(response)
  }) as unknown as typeof fetch
  return calls
}

test('prefixes /api and sends the session cookie', async () => {
  const calls = stubFetch(Response.json({ id: 'u1' }))

  const body = await apiFetch<{ id: string }>('/auth/me')

  expect(body).toEqual({ id: 'u1' })
  expect(calls[0]?.url).toBe('/api/auth/me')
  expect(calls[0]?.init?.credentials).toBe('include')
})

test('sends JSON content type only when there is a body', async () => {
  const withBody = stubFetch(Response.json({ ok: true }))
  await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'a@b.c' }) })
  expect(withBody[0]?.init?.headers).toEqual({ 'Content-Type': 'application/json' })

  const withoutBody = stubFetch(Response.json({ ok: true }))
  await apiFetch('/auth/me')
  expect(withoutBody[0]?.init?.headers).toBeUndefined()
})

test('throws ApiError carrying the status and the API error message', async () => {
  stubFetch(Response.json({ error: 'Invalid email or password' }, { status: 401 }))

  const error = await apiFetch('/auth/login', { method: 'POST' }).catch((err: unknown) => err)

  expect(error).toBeInstanceOf(ApiError)
  expect((error as ApiError).status).toBe(401)
  expect((error as ApiError).message).toBe('Invalid email or password')
})

test('falls back to the status line when the failure body is not JSON', async () => {
  stubFetch(new Response('<html>nope</html>', { status: 502, statusText: 'Bad Gateway' }))

  const error = await apiFetch('/tickets').catch((err: unknown) => err)

  expect((error as ApiError).message).toContain('502')
})

test('returns nothing for a 204', async () => {
  stubFetch(new Response(null, { status: 204 }))

  expect(await apiFetch('/auth/logout', { method: 'POST' })).toBeUndefined()
})

test('acceptStatus treats a listed failure status as a result', async () => {
  stubFetch(Response.json({ status: 'error', database: 'down' }, { status: 503 }))

  const body = await apiFetch<{ database: string }>('/health', { acceptStatus: [503] })

  expect(body.database).toBe('down')
})
