import { expect, test } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { NavigationType } from 'react-router'
import { renderRoute, responds, signedInUser, stubApi } from './helpers.tsx'

test('a logged-out visitor to a protected route lands on /login', async () => {
  stubApi({ '/auth/me': responds.noSession })

  const router = renderRoute('/')

  expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeDefined()
  expect(router.state.location.pathname).toBe('/login')
  // replace, so back does not bounce between / and /login.
  expect(router.state.historyAction).toBe(NavigationType.Replace)
})

// Every protected screen, not only the dashboard: one RequireAuth wraps them
// today, and a route moved outside it would otherwise go unnoticed.
for (const path of ['/tickets', '/tickets/1', '/users']) {
  test(`a logged-out visitor to ${path} lands on /login`, async () => {
    stubApi({ '/auth/me': responds.noSession })

    const router = renderRoute(path)

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeDefined()
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.historyAction).toBe(NavigationType.Replace)
  })
}

test('the protected route shows a labelled spinner while the session check is in flight', () => {
  stubApi({ '/auth/me': responds.currentUser, '/dashboard': responds.dashboard })

  renderRoute('/')

  expect(screen.getByRole('status').textContent).toBe('Checking your session')
})

test('a signed-in visitor stays and sees their name', async () => {
  stubApi({ '/auth/me': responds.currentUser, '/dashboard': responds.dashboard })

  const router = renderRoute('/')

  expect(await screen.findByText(signedInUser.name)).toBeDefined()
  expect(router.state.location.pathname).toBe('/')
})

test('signing out calls the API and returns to /login', async () => {
  const requests = stubApi({
    '/auth/me': responds.currentUser,
    '/dashboard': responds.dashboard,
    '/auth/logout': responds.noContent,
  })

  const router = renderRoute('/')
  await screen.findByRole('button', { name: 'Sign out' })
  await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }))

  await waitFor(() => expect(router.state.location.pathname).toBe('/login'))

  const logoutRequest = requests.find((request) => request.url.endsWith('/api/auth/logout'))
  expect(logoutRequest?.method).toBe('POST')
  expect(logoutRequest?.credentials).toBe('include')
})

test('the session check is not repeated after signing in', async () => {
  const requests = stubApi({
    '/auth/login': responds.currentUser,
    '/dashboard': responds.dashboard,
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

test('a 401 from any request, not only the session check, lands on the login form', async () => {
  const requests = stubApi({
    '/auth/me': responds.currentUser,
    // The session died between the check and the list: an admin deactivated
    // this account, or it expired.
    '/users': () => responds.error(401, 'Unauthorized'),
  })

  const router = renderRoute('/users')

  await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeDefined()
  // Clearing the cache must not make the page still mounted ask again, and
  // again, before the redirect unmounts it.
  expect(requests.filter((request) => request.url.endsWith('/api/users'))).toHaveLength(1)
})
