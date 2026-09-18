import { afterEach, expect, test } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { UserSummary } from '@helpdesk/shared'
import { renderRoute, responds, stubApi } from './helpers.tsx'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

const admin: UserSummary = {
  id: 'u1',
  email: 'admin@helpdesk.io',
  name: 'Ada Admin',
  role: 'admin',
  isActive: true,
  createdAt: '2026-01-05T09:00:00.000Z',
}

const created: UserSummary = {
  id: 'u9',
  email: 'nia@helpdesk.io',
  name: 'Nia New',
  role: 'agent',
  isActive: true,
  createdAt: '2026-09-18T09:00:00.000Z',
}

/**
 * GET answers the list; POST answers with `onPost`. The list grows once a POST
 * has succeeded, the way the real API's would.
 */
function stubUsers(onPost: () => Response = () => Response.json(created, { status: 201 })) {
  let list = [admin]
  return stubApi({
    '/auth/me': responds.currentUser,
    '/users': (request) => {
      if (request.method !== 'POST') return Response.json(list)
      const response = onPost()
      if (response.ok) list = [...list, created]
      return response
    },
  })
}

async function openDialog() {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Add agent' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add agent' })
  return { user, dialog: within(dialog) }
}

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  dialog: ReturnType<typeof within>,
  values: { name: string; email: string; password: string },
) {
  await user.type(dialog.getByLabelText('Name'), values.name)
  await user.type(dialog.getByLabelText('Email'), values.email)
  await user.type(dialog.getByLabelText('Initial password'), values.password)
  await user.click(dialog.getByRole('button', { name: 'Add agent' }))
}

const valid = { name: 'Nia New', email: 'nia@helpdesk.io', password: 'a-long-enough-password' }

test('an admin adds an agent, and the new row appears in the list', async () => {
  const requests = stubUsers()
  renderRoute('/users')

  const { user, dialog } = await openDialog()
  await fill(user, dialog, valid)

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(await screen.findByRole('cell', { name: 'Nia New' })).toBeDefined()

  const post = requests.find((request) => request.method === 'POST')
  expect(await post?.json()).toEqual(valid)

  // Said out loud, not only shown: closing the dialog announces nothing.
  expect(screen.getByText('Nia New was added and can sign in now.')).toBeDefined()
})

test('a short password is refused before any request is sent', async () => {
  const requests = stubUsers()
  renderRoute('/users')

  const { user, dialog } = await openDialog()
  await fill(user, dialog, { ...valid, password: 'short' })

  expect(await dialog.findByText('Use at least 12 characters')).toBeDefined()
  expect(requests.some((request) => request.method === 'POST')).toBe(false)
})

test('an email over 254 characters is refused before any request is sent', async () => {
  const requests = stubUsers()
  renderRoute('/users')

  const { user, dialog } = await openDialog()
  await user.type(dialog.getByLabelText('Name'), valid.name)
  // Pasted, not typed: 255 keystrokes would only slow the test down.
  await user.click(dialog.getByLabelText('Email'))
  await user.paste(`${'a'.repeat(243)}@example.com`)
  await user.type(dialog.getByLabelText('Initial password'), valid.password)
  await user.click(dialog.getByRole('button', { name: 'Add agent' }))

  expect(await dialog.findByText('Use at most 254 characters')).toBeDefined()
  expect(requests.some((request) => request.method === 'POST')).toBe(false)
})

test('a taken email is marked on the email field, and the dialog stays open', async () => {
  stubUsers(() =>
    Response.json({ error: 'A user with that email already exists' }, { status: 409 }),
  )
  renderRoute('/users')

  const { user, dialog } = await openDialog()
  await fill(user, dialog, valid)

  expect(await dialog.findByText('A user with that email already exists')).toBeDefined()
  const email = dialog.getByLabelText('Email')
  expect(email.getAttribute('aria-invalid')).toBe('true')
  // Focus moves to the field that needs changing.
  expect(document.activeElement).toBe(email)
  // Named once, on the field — FieldError is itself an alert — and not repeated
  // as a form-level one above the fields.
  const alerts = dialog.getAllByRole('alert')
  expect(alerts).toHaveLength(1)
  expect(alerts[0]?.getAttribute('data-slot')).toBe('field-error')
  // What was typed is kept, so the admin only has to fix the address.
  expect((dialog.getByLabelText('Name') as HTMLInputElement).value).toBe('Nia New')
})

test('any other failure is shown as a form-level alert', async () => {
  stubUsers(() => Response.json({ error: 'Internal Server Error' }, { status: 500 }))
  renderRoute('/users')

  const { user, dialog } = await openDialog()
  await fill(user, dialog, valid)

  const alert = await dialog.findByRole('alert')
  expect(alert.textContent).toBe('Internal Server Error')
})

test('cancelling clears what was typed, so reopening starts empty', async () => {
  stubUsers()
  renderRoute('/users')

  const first = await openDialog()
  await first.user.type(first.dialog.getByLabelText('Initial password'), 'half-typed-secret')
  await first.user.click(first.dialog.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

  const second = await openDialog()
  expect((second.dialog.getByLabelText('Initial password') as HTMLInputElement).value).toBe('')
})

test('the password field asks the browser for a new password, not a saved one', async () => {
  stubUsers()
  renderRoute('/users')

  const { dialog } = await openDialog()

  // Without this a password manager fills in the admin's own saved password,
  // and the new agent is created with it.
  expect(dialog.getByLabelText('Initial password').getAttribute('autocomplete')).toBe(
    'new-password',
  )
})
