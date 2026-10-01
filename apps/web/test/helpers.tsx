import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import type {
  CurrentUser,
  HealthResponse,
  TicketDetail,
  TicketMessage,
  TicketSummary,
  UserSummary,
} from '@helpdesk/shared'
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

export const agentUser: CurrentUser = {
  id: 'u2',
  email: 'agent@helpdesk.io',
  name: 'Gil Agent',
  role: 'agent',
}

/** A row of the users list: an active agent unless told otherwise. */
export const userSummary = (
  overrides: Partial<UserSummary> & Pick<UserSummary, 'id' | 'name'>,
): UserSummary => ({
  email: `${overrides.id}@helpdesk.io`,
  role: 'agent',
  isActive: true,
  isProtected: false,
  createdAt: '2026-02-01T09:00:00.000Z',
  ...overrides,
})

/** A row of the ticket list: an open, unclassified, unassigned ticket unless told otherwise. */
export const ticketSummary = (
  overrides: Partial<TicketSummary> & Pick<TicketSummary, 'id' | 'subject'>,
): TicketSummary => ({
  studentEmail: 'student@student.example',
  studentName: 'Sam Student',
  status: 'open',
  category: null,
  needsAgent: false,
  escalationReason: null,
  assignee: null,
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-09-01T09:00:00.000Z',
  ...overrides,
})

/** A ticket as the detail page reads it: the summary fields, plus a thread. */
export const ticketDetail = (
  overrides: Partial<TicketDetail> & Pick<TicketDetail, 'id' | 'subject'>,
): TicketDetail => ({
  ...ticketSummary(overrides),
  summary: null,
  autoCloseAt: null,
  senderVerified: true,
  pendingDraft: null,
  messages: [],
  ...overrides,
})

/** One message in a thread: a student's, unless told otherwise. */
export const ticketMessage = (
  overrides: Partial<TicketMessage> & Pick<TicketMessage, 'id' | 'body'>,
): TicketMessage => ({
  direction: 'inbound',
  author: 'student',
  agent: null,
  createdAt: '2026-09-02T09:00:00.000Z',
  ...overrides,
})

const health: HealthResponse = {
  status: 'ok',
  database: 'up',
  timestamp: '2026-01-01T00:00:00.000Z',
}

/** Canned responses for the endpoints the app calls while rendering. */
export const responds = {
  currentUser: () => Response.json(signedInUser),
  currentAgent: () => Response.json(agentUser),
  noSession: () => responds.error(401, 'Unauthorized'),
  health: () => Response.json(health),
  noContent: () => new Response(null, { status: 204 }),
  /** A failure in the API's own shape: a status and an `error` message. */
  error: (status: number, message: string) => Response.json({ error: message }, { status }),
}

/** The table row a user occupies, found by the name in its first cell. */
export async function rowFor(name: string) {
  const cell = await screen.findByRole('cell', { name })
  const row = cell.closest('tr')
  if (!row) throw new Error(`No row for ${name}`)
  return within(row)
}

/**
 * Answers each `/api` path from `handlers` and records every call. An unmapped
 * path 404s loudly rather than silently returning something plausible.
 *
 * Records the `Request` axios built, not a url and an init: its fetch adapter
 * passes one object, and method, credentials and body all hang off it. Nothing
 * here reads the body, so a test still can — `await requests[0].text()`.
 *
 * A handler receives that request, so one path can answer GET and POST apart.
 */
export function stubApi(
  handlers: Record<string, (request: Request) => Response | Promise<Response>>,
): Request[] {
  const requests: Request[] = []

  globalThis.fetch = ((input: Request) => {
    requests.push(input)

    const handler = handlers[new URL(input.url).pathname.replace(/^\/api/, '')]
    if (!handler) {
      return Promise.resolve(Response.json({ error: `No stub for ${input.url}` }, { status: 404 }))
    }
    return Promise.resolve(handler(input))
  }) as unknown as typeof fetch

  return requests
}

/**
 * Mounts the real route table at one path, the way App does in the browser.
 * Pass a query client to start from a cache the test has filled in itself.
 */
export function renderRoute(path: string, queryClient: QueryClient = createQueryClient()) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  // By default the app's own client, so caching and retry behave as they do in
  // the browser; a fresh one per test keeps them from sharing a cache.

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )

  return router
}
