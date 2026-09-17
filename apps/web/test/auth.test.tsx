import { afterEach, expect, test } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { NavigationType } from 'react-router'
import { renderRoute, responds, signedInUser, stubApi } from './helpers.tsx'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('a logged-out visitor to a protected route lands on /login', async () => {
  stubApi({ '/auth/me': responds.noSession })

  const router = renderRoute('/')

  expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeDefined()
  expect(router.state.location.pathname).toBe('/login')
  // replace, so back does not bounce between / and /login.
  expect(router.state.historyAction).toBe(NavigationType.Replace)
})

test('the protected route shows a labelled spinner while the session check is in flight', () => {
  stubApi({ '/auth/me': responds.currentUser, '/health': responds.health })

  renderRoute('/')

  expect(screen.getByRole('status').textContent).toBe('Checking your session')
})

test('a signed-in visitor stays and sees their name', async () => {
  stubApi({ '/auth/me': responds.currentUser, '/health': responds.health })

  const router = renderRoute('/')

  expect(await screen.findByText(signedInUser.name)).toBeDefined()
  expect(router.state.location.pathname).toBe('/')
})

test('signing out calls the API and returns to /login', async () => {
  const requests = stubApi({
    '/auth/me': responds.currentUser,
    '/health': responds.health,
    '/auth/logout': responds.noContent,
  })

  const router = renderRoute('/')
  await screen.findByRole('button', { name: 'Sign out' })
  await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }))

  await waitFor(() => expect(router.state.location.pathname).toBe('/login'))

  const logoutRequest = requests.find((request) => request.url.endsWith('/api/auth/logout'))
  expect(logoutRequest?.init?.method).toBe('POST')
  expect(logoutRequest?.init?.credentials).toBe('include')
})

test('the session check is not repeated after signing in', async () => {
  const requests = stubApi({
    '/auth/login': responds.currentUser,
    '/health': responds.health,
  })

  const router = renderRoute('/login')
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Email'), signedInUser.email)
  await user.type(screen.getByLabelText('Password'), 'correct horse battery')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))

  await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  expect(await screen.findByText(signedInUser.name)).toBeDefined()
  // /auth/me is absent: login's own response seeded the cache.
  expect(requests.filter((request) => request.url.endsWith('/api/auth/me'))).toHaveLength(0)
})
