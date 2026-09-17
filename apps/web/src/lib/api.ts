/**
 * Base origin for API calls. Empty in development, where the Vite dev server
 * proxies /api to the API and keeps requests same-origin; in production it
 * points at api.<domain>, a different origin from the app.
 */
const API_BASE_URL = import.meta.env.VITE_API_URL ?? ''

/** A non-2xx response. `message` is the API's `error` field when it sent one. */
export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export type ApiRequest = RequestInit & {
  /**
   * Statuses whose body is a result rather than a failure. `/api/health`
   * answers 503 with a full health body when the database is down.
   */
  acceptStatus?: number[]
}

/**
 * Calls the API and returns its parsed JSON body, or throws {@link ApiError}.
 * `path` is relative to `/api` — `apiFetch('/auth/me')` hits `/api/auth/me`.
 */
export async function apiFetch<T>(path: string, options: ApiRequest = {}): Promise<T> {
  const { acceptStatus, ...init } = options

  const response = await fetch(`${API_BASE_URL}/api${path}`, {
    // The session lives in a cookie the API sets. Cross-origin requests omit
    // cookies unless asked, so without this every call would look logged out.
    credentials: 'include',
    ...init,
    headers:
      init.body === undefined
        ? init.headers
        : { 'Content-Type': 'application/json', ...init.headers },
  })

  if (!response.ok && !acceptStatus?.includes(response.status)) {
    throw new ApiError(response.status, await errorMessage(response))
  }

  // 204 from logout and other write endpoints that return nothing.
  if (response.status === 204) return undefined as T

  return (await response.json()) as T
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
      return body.error
    }
  } catch {
    // Not JSON — fall through to the status line.
  }
  return `${response.status} ${response.statusText}`.trim()
}
