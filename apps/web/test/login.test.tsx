import { afterEach, expect, test } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { NavigationType, createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { routes } from '../src/routes.tsx'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function renderLogin() {
  const router = createMemoryRouter(routes, { initialEntries: ['/login'] })
  // No retries: a rejected login should surface its error, not be tried again.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )

  return router
}

async function fillAndSubmit(email: string, password: string) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Email'), email)
  await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

test('posts the credentials and lands on the home page', async () => {
  const requests: { url: string; init: RequestInit | undefined }[] = []
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init })
    if (String(input).endsWith('/api/auth/login')) {
      return Promise.resolve(Response.json({ id: 'u1', email: 'admin@helpdesk.io', role: 'admin' }))
    }
    return Promise.resolve(
      Response.json({ status: 'ok', database: 'up', timestamp: '2026-01-01T00:00:00.000Z' }),
    )
  }) as unknown as typeof fetch

  const router = renderLogin()
  await fillAndSubmit('admin@helpdesk.io', 'correct horse battery')

  await waitFor(() => expect(router.state.location.pathname).toBe('/'))

  const loginRequest = requests.find((request) => request.url.endsWith('/api/auth/login'))
  expect(loginRequest?.init?.method).toBe('POST')
  expect(loginRequest?.init?.credentials).toBe('include')
  expect(loginRequest?.init?.body).toBe(
    JSON.stringify({ email: 'admin@helpdesk.io', password: 'correct horse battery' }),
  )
})

test('replaces the login entry so back does not return to it', async () => {
  globalThis.fetch = (() =>
    Promise.resolve(
      Response.json({ id: 'u1', email: 'admin@helpdesk.io', role: 'admin' }),
    )) as unknown as typeof fetch

  const router = renderLogin()
  await fillAndSubmit('admin@helpdesk.io', 'correct horse battery')

  await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  expect(router.state.historyAction).toBe(NavigationType.Replace)
})

test('shows the API message and stays put when the credentials are rejected', async () => {
  globalThis.fetch = (() =>
    Promise.resolve(
      Response.json({ error: 'Invalid email or password' }, { status: 401 }),
    )) as unknown as typeof fetch

  const router = renderLogin()
  await fillAndSubmit('admin@helpdesk.io', 'wrong')

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('Invalid email or password')
  expect(router.state.location.pathname).toBe('/login')
})
