import { afterEach, expect, test } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { routes } from '../src/routes.tsx'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

/** Mounts the real route table at one path, the way App does in the browser. */
function renderRoute(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  // No retries: a failing query should surface its error in the test, not stall.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

test('the home route renders the API health it queried', async () => {
  globalThis.fetch = ((input: string | URL | Request) => {
    expect(String(input)).toBe('/api/health')
    return Promise.resolve(
      Response.json({ status: 'ok', database: 'up', timestamp: '2026-01-01T00:00:00.000Z' }),
    )
  }) as unknown as typeof fetch

  renderRoute('/')

  const status = await screen.findByText(/API status: ok/)
  expect(status.textContent).toContain('database: up')
})

test('the home route reports a failed health query', async () => {
  globalThis.fetch = (() =>
    Promise.resolve(
      Response.json({ error: 'Not Found' }, { status: 404 }),
    )) as unknown as typeof fetch

  renderRoute('/')

  expect(await screen.findByText(/API unreachable: Not Found/)).toBeDefined()
})

test('the login route renders', () => {
  renderRoute('/login')

  expect(screen.getByRole('heading', { name: 'Sign in' })).toBeDefined()
})

test('an unknown path renders the not-found route', () => {
  renderRoute('/nowhere')

  expect(screen.getByRole('heading', { name: 'Page not found' })).toBeDefined()
})
