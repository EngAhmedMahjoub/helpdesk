import { QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { CurrentUser, HealthResponse } from '@helpdesk/shared'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { createQueryClient } from '../src/lib/query-client.ts'
import { routes } from '../src/routes.tsx'

export const signedInUser: CurrentUser = {
  id: 'u1',
  email: 'admin@helpdesk.io',
  name: 'Ada Admin',
  role: 'admin',
}

const health: HealthResponse = {
  status: 'ok',
  database: 'up',
  timestamp: '2026-01-01T00:00:00.000Z',
}

/** Canned responses for the endpoints the app calls while rendering. */
export const responds = {
  currentUser: () => Response.json(signedInUser),
  noSession: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
  health: () => Response.json(health),
  noContent: () => new Response(null, { status: 204 }),
}

export type RecordedRequest = { url: string; init: RequestInit | undefined }

/**
 * Answers each `/api` path from `handlers` and records every call. An unmapped
 * path 404s loudly rather than silently returning something plausible.
 */
export function stubApi(handlers: Record<string, () => Response>): RecordedRequest[] {
  const requests: RecordedRequest[] = []

  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    requests.push({ url, init })

    const handler = handlers[url.replace(/^\/api/, '')]
    if (!handler) {
      return Promise.resolve(Response.json({ error: `No stub for ${url}` }, { status: 404 }))
    }
    return Promise.resolve(handler())
  }) as unknown as typeof fetch

  return requests
}

/** Mounts the real route table at one path, the way App does in the browser. */
export function renderRoute(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  // The app's own defaults, so caching and retry behave as they do in the
  // browser; a fresh client per test keeps them from sharing a cache.
  const queryClient = createQueryClient()

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )

  return router
}
