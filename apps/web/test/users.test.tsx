import { expect, test } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import { NavigationType } from 'react-router'
import type { UserSummary } from '@helpdesk/shared'
import {
  agentUser,
  renderRoute,
  responds,
  rowFor,
  signedInUser,
  stubApi,
  userSummary,
} from './helpers.tsx'

const users: UserSummary[] = [
  userSummary({
    id: 'u1',
    email: 'admin@helpdesk.io',
    name: 'Ada Admin',
    role: 'admin',
    createdAt: '2026-01-05T09:00:00.000Z',
  }),
  userSummary({
    id: 'u2',
    email: 'gil@helpdesk.io',
    name: 'Gil Agent',
    createdAt: '2026-02-10T09:00:00.000Z',
  }),
  userSummary({
    id: 'u3',
    email: 'former@helpdesk.io',
    name: 'Fay Former',
    isActive: false,
    createdAt: '2026-03-15T09:00:00.000Z',
  }),
]

test('an admin sees every user, in the order the API sent them', async () => {
  stubApi({ '/auth/me': responds.currentUser, '/users': () => Response.json(users) })

  renderRoute('/users')

  await screen.findByRole('cell', { name: 'Ada Admin' })
  const names = screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => (row as HTMLTableRowElement).cells[0]?.textContent)
  expect(names).toEqual(['Ada Admin', 'Gil Agent', 'Fay Former'])
})

test('each row carries the email, role and status', async () => {
  stubApi({ '/auth/me': responds.currentUser, '/users': () => Response.json(users) })

  renderRoute('/users')

  const admin = await rowFor('Ada Admin')
  expect(admin.getByText('admin@helpdesk.io')).toBeDefined()
  expect(admin.getByText('admin')).toBeDefined()
  expect(admin.getByText('Active')).toBeDefined()

  const former = await rowFor('Fay Former')
  expect(former.getByText('agent')).toBeDefined()
  // A deactivated user is listed and labelled, not hidden: the admin has to be
  // able to find them to switch them back on in 2.6.
  expect(former.getByText('Deactivated')).toBeDefined()
})

test('shows the API message when the list cannot be loaded', async () => {
  stubApi({
    '/auth/me': responds.currentUser,
    '/users': () => responds.error(403, 'Forbidden'),
  })

  renderRoute('/users')

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('Forbidden')
})

test('an agent typing /users is sent to the dashboard and never asks for the list', async () => {
  const requests = stubApi({ '/auth/me': responds.currentAgent, '/health': responds.health })

  const router = renderRoute('/users')

  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/')
  })
  // The guard has to redirect before the page mounts, or the agent's browser
  // fires a request the API only answers with 403.
  expect(requests.filter((request) => request.url.endsWith('/api/users'))).toHaveLength(0)
  expect(screen.queryByRole('table')).toBeNull()
})

test('the redirect replaces the entry, so Back does not bounce', async () => {
  stubApi({ '/auth/me': responds.currentAgent, '/health': responds.health })

  const router = renderRoute('/users')

  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/')
  })
  expect(router.state.historyAction).toBe(NavigationType.Replace)
})

test('an admin is not redirected away from their own screen', async () => {
  stubApi({ '/auth/me': responds.currentUser, '/users': () => Response.json(users) })

  const router = renderRoute('/users')

  await screen.findByRole('table')
  expect(router.state.location.pathname).toBe('/users')
  // Guards against a guard that reads the role before the session resolves and
  // redirects the very people the screen is for.
  expect(signedInUser.role).toBe('admin')
  expect(agentUser.role).toBe('agent')
})

test('shows a skeleton while the list loads, then swaps in the table', async () => {
  // Held open so the pending state lasts long enough to look at.
  let release: (response: Response) => void = () => {}
  stubApi({
    '/auth/me': responds.currentUser,
    '/users': () => new Promise<Response>((resolve) => (release = resolve)),
  })

  renderRoute('/users')

  // Found by its text, then walked up to the region: a status is named by an
  // author label, not its contents, and the session check's spinner is also a
  // status that shows first.
  const loading = (await screen.findByText('Loading users')).closest('[role="status"]')
  expect(loading?.getAttribute('aria-busy')).toBe('true')
  // The placeholder is hidden from assistive tech, so it is not a second table.
  expect(screen.queryByRole('table')).toBeNull()

  release(Response.json(users))

  await screen.findByRole('table')
  expect(screen.queryByText('Loading users')).toBeNull()
})
