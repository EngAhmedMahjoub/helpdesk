import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios'

/**
 * Base origin for API calls. Empty in development, where the Vite dev server
 * proxies /api to the API and keeps requests same-origin; in production it
 * points at api.helpdesk.mahjoub.io, a different origin from the app.
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

/** True when `error` is an {@link ApiError} with this status. */
export function isApiError(error: unknown, status: number): error is ApiError {
  return error instanceof ApiError && error.status === status
}

export const apiClient = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  // The session lives in a cookie the API sets. Cross-origin requests omit
  // cookies unless asked, so without this every call would look logged out.
  withCredentials: true,
  // The fetch adapter rather than the default xhr. It is what runs anywhere the
  // app actually ships, and it keeps one seam — global fetch — for the tests to
  // stand in front of, instead of an XMLHttpRequest happy-dom would try to send
  // over the wire for real.
  adapter: 'fetch',
})

// One place where an HTTP failure becomes an ApiError, so every caller sees the
// same type whether it goes through apiRequest or reaches for apiClient itself.
apiClient.interceptors.response.use(undefined, (error: unknown) => {
  if (axios.isAxiosError(error) && error.response) {
    return Promise.reject(new ApiError(error.response.status, errorMessage(error.response)))
  }

  // No response at all: the network failed, or the request was aborted. Left as
  // it is on purpose — the query client retries anything that is not an ApiError
  // under 500, and a dropped connection deserves that retry where a 401 does not.
  return Promise.reject(error)
})

type ApiRequest = AxiosRequestConfig & {
  /**
   * Statuses whose body is a result rather than a failure. `/api/health`
   * answers 503 with a full health body when the database is down.
   */
  acceptStatus?: number[]
}

/**
 * Calls the API and returns its parsed JSON body, or throws {@link ApiError}.
 * `path` is relative to `/api` — `apiRequest('/auth/me')` hits `/api/auth/me`.
 */
export async function apiRequest<T>(path: string, options: ApiRequest = {}): Promise<T> {
  const { acceptStatus, ...config } = options

  const response = await apiClient.request<T>({
    url: path,
    ...config,
    ...(acceptStatus && {
      validateStatus: (status) => (status >= 200 && status < 300) || acceptStatus.includes(status),
    }),
  })

  // 204 from logout and other write endpoints that return nothing.
  if (response.status === 204) return undefined as T

  return response.data
}

function errorMessage(response: AxiosResponse<unknown>): string {
  const body = response.data
  if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
    return body.error
  }
  // Not the shape the API uses for errors — a proxy's HTML page, most likely.
  return `${response.status} ${response.statusText}`.trim()
}
