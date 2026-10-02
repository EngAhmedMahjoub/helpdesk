import { expect, test } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { agentUser, renderRoute, responds, signedInUser, stubApi } from './helpers.tsx'

/** The nav, addressed by its label so the assertions ignore the rest of the page. */
function nav() {
  return screen.getByRole('navigation', { name: 'Main' })
}

test('an agent does not see the Users link', async () => {
  stubApi({ '/auth/me': responds.currentAgent, '/dashboard': responds.dashboard })

  renderRoute('/')

  expect(await screen.findByText(agentUser.name)).toBeDefined()
  expect(screen.queryByRole('link', { name: 'Users' })).toBeNull()
  // The rest of the nav is still there, so the absence is the role, not a
  // layout that failed to render.
  expect(screen.getByRole('link', { name: 'Dashboard' })).toBeDefined()
  expect(screen.getByRole('link', { name: 'Tickets' })).toBeDefined()
})

test('an admin sees the Users link', async () => {
  stubApi({ '/auth/me': responds.currentUser, '/dashboard': responds.dashboard })

  renderRoute('/')

  expect(await screen.findByText(signedInUser.name)).toBeDefined()
  expect(screen.getByRole('link', { name: 'Users' })).toBeDefined()
})

test('the nav marks the current route as current', async () => {
  stubApi({ '/auth/me': responds.currentUser, '/dashboard': responds.dashboard })

  renderRoute('/tickets')

  const tickets = await screen.findByRole('link', { name: 'Tickets' })
  expect(tickets.getAttribute('aria-current')).toBe('page')
  // end on the Dashboard link, or "/" would match every route.
  expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('aria-current')).toBeNull()
})

test('a nav link moves between screens without leaving the layout', async () => {
  stubApi({ '/auth/me': responds.currentUser, '/dashboard': responds.dashboard })

  const router = renderRoute('/')
  await screen.findByText(signedInUser.name)
  await userEvent.setup().click(screen.getByRole('link', { name: 'Users' }))

  await waitFor(() => expect(router.state.location.pathname).toBe('/users'))
  expect(screen.getByRole('heading', { name: 'Users' })).toBeDefined()
  expect(nav()).toBeDefined()
})

test('the Helpdesk name in the header goes home', async () => {
  stubApi({ '/auth/me': responds.currentUser, '/dashboard': responds.dashboard })

  const router = renderRoute('/tickets')
  await screen.findByText(signedInUser.name)
  await userEvent.setup().click(screen.getByRole('link', { name: 'Helpdesk' }))

  await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  // Outside the Main nav on purpose: it is the brand, not a second Dashboard item.
  expect(within(nav()).queryByRole('link', { name: 'Helpdesk' })).toBeNull()
})
