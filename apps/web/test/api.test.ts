import { expect, test } from 'bun:test'
import { ApiError, apiRequest } from '../src/lib/api.ts'

/**
 * Captures the request axios hands to fetch. The fetch adapter passes a Request
 * object rather than a url and an init, so everything is read off that.
 */
function stubFetch(response: Response) {
  const calls: Request[] = []
  globalThis.fetch = ((input: Request) => {
    calls.push(input)
    return Promise.resolve(response)
  }) as unknown as typeof fetch
  return calls
}

test('prefixes /api and sends the session cookie', async () => {
  const calls = stubFetch(Response.json({ id: 'u1' }))

  const body = await apiRequest<{ id: string }>('/auth/me')

  expect(body).toEqual({ id: 'u1' })
  expect(calls[0]?.url).toContain('/api/auth/me')
  expect(calls[0]?.credentials).toBe('include')
})

test('serialises a data object as JSON', async () => {
  const calls = stubFetch(Response.json({ ok: true }))

  await apiRequest('/auth/login', { method: 'POST', data: { email: 'a@b.c' } })

  expect(calls[0]?.method).toBe('POST')
  expect(calls[0]?.headers.get('content-type')).toContain('application/json')
  expect(await calls[0]?.text()).toBe('{"email":"a@b.c"}')
})

test('sends no JSON content type when there is no body', async () => {
  const calls = stubFetch(Response.json({ ok: true }))

  await apiRequest('/auth/me')

  expect(calls[0]?.headers.get('content-type')).toBeNull()
})

test('throws ApiError carrying the status and the API error message', async () => {
  stubFetch(Response.json({ error: 'Invalid email or password' }, { status: 401 }))

  const error = await apiRequest('/auth/login', { method: 'POST' }).catch((err: unknown) => err)

  expect(error).toBeInstanceOf(ApiError)
  expect((error as ApiError).status).toBe(401)
  expect((error as ApiError).message).toBe('Invalid email or password')
})

test('falls back to the status line when the failure body is not JSON', async () => {
  stubFetch(new Response('<html>nope</html>', { status: 502, statusText: 'Bad Gateway' }))

  const error = await apiRequest('/tickets').catch((err: unknown) => err)

  expect(error).toBeInstanceOf(ApiError)
  expect((error as ApiError).message).toContain('502')
})

test('leaves a network failure as it is, so the query client still retries it', async () => {
  globalThis.fetch = (() =>
    Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch

  const error = await apiRequest('/auth/me').catch((err: unknown) => err)

  // Not an ApiError: there is no status to carry, and the retry rule keys off it.
  expect(error).not.toBeInstanceOf(ApiError)
})

test('returns nothing for a 204', async () => {
  stubFetch(new Response(null, { status: 204 }))

  expect(await apiRequest('/auth/logout', { method: 'POST' })).toBeUndefined()
})

test('acceptStatus treats a listed failure status as a result', async () => {
  stubFetch(Response.json({ status: 'error', database: 'down' }, { status: 503 }))

  const body = await apiRequest<{ database: string }>('/health', { acceptStatus: [503] })

  expect(body.database).toBe('down')
})

test('acceptStatus does not excuse a status it does not list', async () => {
  stubFetch(Response.json({ error: 'Unauthorized' }, { status: 401 }))

  const error = await apiRequest('/health', { acceptStatus: [503] }).catch((err: unknown) => err)

  expect((error as ApiError).status).toBe(401)
})
