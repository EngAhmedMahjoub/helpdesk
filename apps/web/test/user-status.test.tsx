import { afterEach, expect, test } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { UserSummary } from '@helpdesk/shared'
import { renderRoute, responds, signedInUser, stubApi } from './helpers.tsx'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

// u1 is the signed-in admin in helpers.tsx.
const users: UserSummary[] = [
  {
    id: signedInUser.id,
    email: signedInUser.email,
    name: signedInUser.name,
    role: 'admin',
    isActive: true,
    createdAt: '2026-01-05T09:00:00.000Z',
  },
  {
    id: 'u2',
    email: 'gil@helpdesk.io',
    name: 'Gil Agent',
    role: 'agent',
    isActive: true,
    createdAt: '2026-02-10T09:00:00.000Z',
  },
  {
    id: 'u3',
    email: 'fay@helpdesk.io',
    name: 'Fay Former',
    role: 'agent',
    isActive: false,
    createdAt: '2026-03-15T09:00:00.000Z',
  },
]

/**
 * GET answers the list; PATCH answers with `onPatch` and, when it succeeds,
 * applies the change so the refetched list shows it, as the real API would.
 */
function stubUsers(onPatch?: () => Response) {
  let list = users.map((user) => ({ ...user }))
  return stubApi({
    '/auth/me': responds.currentUser,
    '/users': () => Response.json(list),
    '/users/u2': (request) => patch(request, 'u2'),
    '/users/u3': (request) => patch(request, 'u3'),
  })

  async function patch(request: Request, id: string) {
    const { isActive } = (await request.clone().json()) as { isActive: boolean }
    const response = onPatch?.()
    if (response && !response.ok) return response
    list = list.map((user) => (user.id === id ? { ...user, isActive } : user))
    return Response.json(list.find((user) => user.id === id))
  }
}

async function rowFor(name: string) {
  const cell = await screen.findByRole('cell', { name })
  return within(cell.closest('tr')!)
}

function patches(requests: Request[]) {
  return requests.filter((request) => request.method === 'PATCH')
}

test('deactivating asks first, then marks the agent and says so', async () => {
  const requests = stubUsers()
  renderRoute('/users')
  const user = userEvent.setup()

  await user.click(await screen.findByRole('button', { name: 'Deactivate Gil Agent' }))
  const confirm = within(await screen.findByRole('alertdialog', { name: 'Deactivate Gil Agent?' }))
  expect(patches(requests)).toHaveLength(0)

  await user.click(confirm.getByRole('button', { name: 'Deactivate' }))

  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(await patches(requests)[0]?.json()).toEqual({ isActive: false })
  expect(patches(requests)[0]?.url).toEndWith('/api/users/u2')

  const row = await rowFor('Gil Agent')
  expect(await row.findByText('Deactivated')).toBeDefined()
  // The row's action flips with its state.
  expect(row.getByRole('button', { name: 'Reactivate Gil Agent' })).toBeDefined()
  expect(screen.getByText('Gil Agent was deactivated and signed out.')).toBeDefined()
})

test('cancelling the confirmation changes nothing', async () => {
  const requests = stubUsers()
  renderRoute('/users')
  const user = userEvent.setup()

  await user.click(await screen.findByRole('button', { name: 'Deactivate Gil Agent' }))
  const confirm = within(await screen.findByRole('alertdialog'))
  await user.click(confirm.getByRole('button', { name: 'Cancel' }))

  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(patches(requests)).toHaveLength(0)
  expect((await rowFor('Gil Agent')).getByText('Active')).toBeDefined()
})

test('a failed deactivation stays in the dialog, beside the button that caused it', async () => {
  stubUsers(() => Response.json({ error: 'Internal Server Error' }, { status: 500 }))
  renderRoute('/users')
  const user = userEvent.setup()

  await user.click(await screen.findByRole('button', { name: 'Deactivate Gil Agent' }))
  const dialog = await screen.findByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }))

  expect((await within(dialog).findByRole('alert')).textContent).toBe('Internal Server Error')
  expect(screen.getByRole('alertdialog')).toBe(dialog)
})

test('reactivating needs no confirmation and says so', async () => {
  const requests = stubUsers()
  renderRoute('/users')

  await userEvent
    .setup()
    .click(await screen.findByRole('button', { name: 'Reactivate Fay Former' }))

  expect(await screen.findByText('Fay Former was reactivated and can sign in again.')).toBeDefined()
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(await patches(requests)[0]?.json()).toEqual({ isActive: true })
  expect(await (await rowFor('Fay Former')).findByText('Active')).toBeDefined()
})

test("the admin's own row offers no way to deactivate themselves", async () => {
  stubUsers()
  renderRoute('/users')

  const own = await rowFor(signedInUser.name)
  // The API refuses it with 409; a button that could only fail is not offered.
  expect(own.queryByRole('button')).toBeNull()
  expect(own.getByText('You')).toBeDefined()
})

test('a 401 from a mutation lands on the login form too', async () => {
  stubUsers(() => Response.json({ error: 'Unauthorized' }, { status: 401 }))
  const router = renderRoute('/users')

  await userEvent
    .setup()
    .click(await screen.findByRole('button', { name: 'Reactivate Fay Former' }))

  await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
})
