import { afterEach, expect, test } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { NavigationType } from 'react-router'
import { renderRoute, responds, signedInUser, stubApi } from './helpers.tsx'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

async function fillAndSubmit(email: string, password: string) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Email'), email)
  await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

test('posts the credentials and lands on the home page', async () => {
  const requests = stubApi({ '/auth/login': responds.currentUser, '/health': responds.health })

  const router = renderRoute('/login')
  await fillAndSubmit(signedInUser.email, 'correct horse battery')

  await waitFor(() => expect(router.state.location.pathname).toBe('/'))

  const loginRequest = requests.find((request) => request.url.endsWith('/api/auth/login'))
  expect(loginRequest?.method).toBe('POST')
  expect(loginRequest?.credentials).toBe('include')
  expect(await loginRequest?.text()).toBe(
    JSON.stringify({ email: signedInUser.email, password: 'correct horse battery' }),
  )
})

test('replaces the login entry so back does not return to it', async () => {
  stubApi({ '/auth/login': responds.currentUser, '/health': responds.health })

  const router = renderRoute('/login')
  await fillAndSubmit(signedInUser.email, 'correct horse battery')

  await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  expect(router.state.historyAction).toBe(NavigationType.Replace)
})

test('shows the API message and stays put when the credentials are rejected', async () => {
  const router = renderRoute('/login')
  stubApi({
    '/auth/login': () => Response.json({ error: 'Invalid email or password' }, { status: 401 }),
  })

  await fillAndSubmit(signedInUser.email, 'wrong')

  expect(await screen.findByText('Invalid email or password')).toBeDefined()
  expect(router.state.location.pathname).toBe('/login')
})

test('rejects a malformed email without asking the API', async () => {
  const requests = stubApi({ '/auth/login': responds.currentUser })

  renderRoute('/login')
  await fillAndSubmit('admin@helpdesk', 'correct horse battery')

  expect(await screen.findByText('Enter a valid email address')).toBeDefined()
  expect(requests).toHaveLength(0)
})

test('rejects an empty password without asking the API', async () => {
  const requests = stubApi({ '/auth/login': responds.currentUser })

  renderRoute('/login')
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Email'), signedInUser.email)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))

  expect(await screen.findByText('Enter your password')).toBeDefined()
  expect(requests).toHaveLength(0)
})

test('marks the offending field invalid for assistive tech', async () => {
  stubApi({ '/auth/login': responds.currentUser })

  renderRoute('/login')
  await fillAndSubmit('admin@helpdesk', 'correct horse battery')

  await screen.findByText('Enter a valid email address')
  expect(screen.getByLabelText('Email').getAttribute('aria-invalid')).toBe('true')
  expect(screen.getByLabelText('Password').getAttribute('aria-invalid')).toBe('false')
})
