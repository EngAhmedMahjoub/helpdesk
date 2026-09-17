import { afterEach, expect, test } from 'bun:test'
import { screen } from '@testing-library/react'
import { renderRoute, responds, stubApi } from './helpers.tsx'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('the home route renders the API health it queried', async () => {
  stubApi({ '/auth/me': responds.currentUser, '/health': responds.health })

  renderRoute('/')

  const status = await screen.findByText(/API status: ok/)
  expect(status.textContent).toContain('database: up')
})

test('the home route reports a failed health query', async () => {
  stubApi({
    '/auth/me': responds.currentUser,
    '/health': () => Response.json({ error: 'Not Found' }, { status: 404 }),
  })

  renderRoute('/')

  expect(await screen.findByText(/API unreachable: Not Found/)).toBeDefined()
})

test('the login route renders', () => {
  stubApi({})

  renderRoute('/login')

  expect(screen.getByRole('heading', { name: 'Sign in' })).toBeDefined()
})

test('an unknown path renders the not-found route', () => {
  stubApi({})

  renderRoute('/nowhere')

  expect(screen.getByRole('heading', { name: 'Page not found' })).toBeDefined()
})
