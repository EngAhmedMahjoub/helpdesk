import { expect, test } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { UserSummary } from '@helpdesk/shared'
import { renderRoute, responds, rowFor, signedInUser, stubApi, userSummary } from './helpers.tsx'

/** The list, with the signed-in admin (u1) either the seeded one or not. */
function usersFor(viewerIsSeeded: boolean): UserSummary[] {
  return [
    userSummary({
      id: signedInUser.id,
      name: signedInUser.name,
      role: 'admin',
      isProtected: viewerIsSeeded,
    }),
    // When the viewer is not the seeded admin, someone else is.
    userSummary({ id: 'seed', name: 'Sam Seed', role: 'admin', isProtected: !viewerIsSeeded }),
    userSummary({ id: 'other-admin', name: 'Olga Admin', role: 'admin' }),
    userSummary({ id: 'gil', name: 'Gil Agent', email: 'gil@helpdesk.io' }),
    userSummary({ id: 'fay', name: 'Fay Former', isActive: false }),
  ]
}

/**
 * GET answers the list; PATCH answers with `onPatch` and, when it succeeds,
 * applies the change so the refetched list shows it, as the real API would.
 */
function stubUsers({
  viewerIsSeeded = false,
  onPatch,
}: { viewerIsSeeded?: boolean; onPatch?: () => Response } = {}) {
  let list = usersFor(viewerIsSeeded)
  const handlers: Record<string, (request: Request) => Promise<Response> | Response> = {
    '/auth/me': responds.currentUser,
    '/users': () => Response.json(list),
  }
  for (const { id } of list) {
    handlers[`/users/${id}`] = async (request) => {
      const changes = (await request.clone().json()) as Partial<UserSummary>
      const failure = onPatch?.()
      if (failure) return failure
      const { password: _password, ...visible } = changes as Partial<UserSummary> & {
        password?: string
      }
      list = list.map((each) => (each.id === id ? { ...each, ...visible } : each))
      return Response.json(list.find((each) => each.id === id))
    }
  }
  return stubApi(handlers)
}

async function openEditor(name: string) {
  const u = userEvent.setup()
  await u.click(await screen.findByRole('button', { name: `Edit ${name}` }))
  const dialog = within(await screen.findByRole('dialog', { name: `Edit ${name}` }))
  return { u, dialog }
}

const patches = (requests: Request[]) => requests.filter((r) => r.method === 'PATCH')

test('saves only what changed, then shows it and says so', async () => {
  const requests = stubUsers()
  renderRoute('/users')

  const { u, dialog } = await openEditor('Gil Agent')
  // Filled from the row, so the admin edits rather than retypes.
  expect((dialog.getByLabelText('Email') as HTMLInputElement).value).toBe('gil@helpdesk.io')

  await u.clear(dialog.getByLabelText('Name'))
  await u.type(dialog.getByLabelText('Name'), 'Gil Renamed')
  await u.click(dialog.getByRole('button', { name: 'Save changes' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  // Email untouched and password blank: neither is sent.
  expect(await patches(requests)[0]?.json()).toEqual({ name: 'Gil Renamed' })
  expect(await screen.findByRole('cell', { name: 'Gil Renamed' })).toBeDefined()
  expect(screen.getByText('Gil Renamed was updated.')).toBeDefined()
})

test('saving with nothing changed sends nothing', async () => {
  const requests = stubUsers()
  renderRoute('/users')

  const { u, dialog } = await openEditor('Gil Agent')
  await u.click(dialog.getByRole('button', { name: 'Save changes' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(patches(requests)).toHaveLength(0)
})

test('a new password is sent, and the admin is told it signed them out', async () => {
  const requests = stubUsers()
  renderRoute('/users')

  const { u, dialog } = await openEditor('Gil Agent')
  expect(dialog.getByLabelText('New password').getAttribute('autocomplete')).toBe('new-password')
  await u.type(dialog.getByLabelText('New password'), 'a-brand-new-password')
  await u.click(dialog.getByRole('button', { name: 'Save changes' }))

  expect(
    await screen.findByText(
      'Gil Agent was updated. They were signed out and must use the new password.',
    ),
  ).toBeDefined()
  expect(await patches(requests)[0]?.json()).toEqual({ password: 'a-brand-new-password' })
})

test('a short new password is refused before any request', async () => {
  const requests = stubUsers()
  renderRoute('/users')

  const { u, dialog } = await openEditor('Gil Agent')
  await u.type(dialog.getByLabelText('New password'), 'short')
  await u.click(dialog.getByRole('button', { name: 'Save changes' }))

  expect(await dialog.findByText('Use at least 12 characters')).toBeDefined()
  expect(patches(requests)).toHaveLength(0)
})

test('a taken email is marked on the field, and the dialog stays open', async () => {
  stubUsers({
    onPatch: () => responds.error(409, 'A user with that email already exists'),
  })
  renderRoute('/users')

  const { u, dialog } = await openEditor('Gil Agent')
  await u.clear(dialog.getByLabelText('Email'))
  await u.type(dialog.getByLabelText('Email'), 'taken@helpdesk.io')
  await u.click(dialog.getByRole('button', { name: 'Save changes' }))

  expect(await dialog.findByText('A user with that email already exists')).toBeDefined()
  expect(document.activeElement).toBe(dialog.getByLabelText('Email'))
})

test('deactivating from the dialog asks first, then marks the agent and says so', async () => {
  const requests = stubUsers()
  renderRoute('/users')

  const { u, dialog } = await openEditor('Gil Agent')
  await u.click(dialog.getByRole('button', { name: 'Deactivate Gil Agent' }))
  const confirm = within(await screen.findByRole('alertdialog', { name: 'Deactivate Gil Agent?' }))
  expect(patches(requests)).toHaveLength(0)

  await u.click(confirm.getByRole('button', { name: 'Deactivate' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(await patches(requests)[0]?.json()).toEqual({ isActive: false })
  expect(await (await rowFor('Gil Agent')).findByText('Deactivated')).toBeDefined()
  expect(screen.getByText('Gil Agent was deactivated and signed out.')).toBeDefined()
})

test('cancelling the deactivation changes nothing', async () => {
  const requests = stubUsers()
  renderRoute('/users')

  const { u, dialog } = await openEditor('Gil Agent')
  await u.click(dialog.getByRole('button', { name: 'Deactivate Gil Agent' }))
  const confirm = within(await screen.findByRole('alertdialog'))
  await u.click(confirm.getByRole('button', { name: 'Cancel' }))

  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(patches(requests)).toHaveLength(0)
  // Back in the editor rather than out of it, and the agent is still active.
  expect(screen.getByRole('dialog', { name: 'Edit Gil Agent' })).toBeDefined()
  expect(dialog.getByRole('button', { name: 'Deactivate Gil Agent' })).toBeDefined()
})

test('a failed deactivation stays in the confirmation, beside its button', async () => {
  stubUsers({
    onPatch: () => responds.error(500, 'Internal Server Error'),
  })
  renderRoute('/users')

  const { u, dialog } = await openEditor('Gil Agent')
  await u.click(dialog.getByRole('button', { name: 'Deactivate Gil Agent' }))
  const confirm = await screen.findByRole('alertdialog')
  await u.click(within(confirm).getByRole('button', { name: 'Deactivate' }))

  expect((await within(confirm).findByRole('alert')).textContent).toBe('Internal Server Error')
})

test('reactivating from the dialog needs no confirmation', async () => {
  const requests = stubUsers()
  renderRoute('/users')

  const { u, dialog } = await openEditor('Fay Former')
  await u.click(dialog.getByRole('button', { name: 'Reactivate Fay Former' }))

  expect(await screen.findByText('Fay Former was reactivated and can sign in again.')).toBeDefined()
  expect(await patches(requests)[0]?.json()).toEqual({ isActive: true })
})

test('an admin who is not the seeded one can edit themselves and agents, and no other admin', async () => {
  stubUsers({ viewerIsSeeded: false })
  renderRoute('/users')

  // Other admins, seeded or not: no pencil, and a reason in place of one.
  expect((await rowFor('Olga Admin')).queryByRole('button')).toBeNull()
  const seeded = await rowFor('Sam Seed')
  expect(seeded.queryByRole('button')).toBeNull()
  expect(seeded.getByText('Protected')).toBeDefined()

  expect((await rowFor('Gil Agent')).getByRole('button', { name: 'Edit Gil Agent' })).toBeDefined()

  // Their own details, but not their own access.
  const { dialog } = await openEditor(signedInUser.name)
  expect(dialog.getByText('You cannot deactivate your own account.')).toBeDefined()
  expect(dialog.queryByRole('button', { name: /Deactivate/ })).toBeNull()
})

test('the seeded admin can edit and deactivate another admin, but not deactivate themselves', async () => {
  stubUsers({ viewerIsSeeded: true })
  renderRoute('/users')

  const other = await openEditor('Olga Admin')
  expect(other.dialog.getByRole('button', { name: 'Deactivate Olga Admin' })).toBeDefined()
  await other.u.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

  const own = await openEditor(signedInUser.name)
  expect(own.dialog.getByText('You cannot deactivate your own account.')).toBeDefined()
})

test('a 401 from saving lands on the login form', async () => {
  stubUsers({ onPatch: () => responds.error(401, 'Unauthorized') })
  const router = renderRoute('/users')

  const { u, dialog } = await openEditor('Gil Agent')
  await u.type(dialog.getByLabelText('New password'), 'a-brand-new-password')
  await u.click(dialog.getByRole('button', { name: 'Save changes' }))

  await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
})
