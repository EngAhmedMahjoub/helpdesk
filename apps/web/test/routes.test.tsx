import { expect, test } from 'bun:test'
import { screen } from '@testing-library/react'
import { renderRoute, responds, stubApi } from './helpers.tsx'

test('the home route renders the dashboard', async () => {
  stubApi({
    '/auth/me': responds.currentUser,
    '/dashboard': responds.dashboard,
    '/tickets': responds.noTickets,
  })

  renderRoute('/')

  expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeDefined()
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
