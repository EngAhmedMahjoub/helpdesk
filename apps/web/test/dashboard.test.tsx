import { expect, test } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { createQueryClient } from '../src/lib/query-client.ts'
import { dashboardCounts, renderRoute, responds, stubApi } from './helpers.tsx'

/** The number a tile in this section shows under this label. */
function tile(section: string, label: string) {
  const term = within(screen.getByRole('region', { name: section })).getByText(label)
  return term.nextElementSibling?.textContent
}

test('shows the counts the API returned', async () => {
  stubApi({
    '/auth/me': responds.currentUser,
    '/dashboard': () =>
      Response.json(
        dashboardCounts({
          total: 1284,
          byStatus: { open: 40, resolved: 44, closed: 1200 },
          byCategory: { general: 600, technical: 500, refund: 180 },
          uncategorized: 4,
          needsAgent: 7,
        }),
      ),
  })

  renderRoute('/')

  expect((await screen.findByText('Needs an agent')).nextElementSibling?.textContent).toBe('7')
  expect(tile('By status', 'Open')).toBe('40')
  expect(tile('By status', 'Resolved')).toBe('44')
  expect(tile('By status', 'Closed')).toBe('1,200')
  expect(tile('By category', 'General')).toBe('600')
  expect(tile('By category', 'Technical')).toBe('500')
  expect(tile('By category', 'Refund')).toBe('180')
  // Unclassified tickets are counted too, so the row adds up to the total.
  expect(tile('By category', 'Not yet classified')).toBe('4')
  expect(screen.getAllByText('of 1,284 tickets')).toHaveLength(2)
})

test('the needs-agent link opens the ticket list filtered to them', async () => {
  stubApi({
    '/auth/me': responds.currentUser,
    '/dashboard': () => Response.json(dashboardCounts({ needsAgent: 3 })),
    '/tickets': () => Response.json({ tickets: [], page: 1, pageSize: 20, total: 0 }),
  })

  const router = renderRoute('/')
  await userEvent
    .setup()
    .click(await screen.findByRole('link', { name: 'View tickets needing an agent' }))

  await waitFor(() => expect(router.state.location.pathname).toBe('/tickets'))
  expect(router.state.location.search).toBe('?needsAgent=true')
})

test('shows a labelled placeholder while the counts load', async () => {
  stubApi({
    '/auth/me': responds.currentUser,
    '/dashboard': () => new Promise<Response>(() => {}),
  })

  renderRoute('/')

  const status = (await screen.findByText('Loading the dashboard')).closest('[role="status"]')
  expect(status?.getAttribute('aria-busy')).toBe('true')
})

test('shows the error when the counts cannot be loaded', async () => {
  stubApi({
    '/auth/me': responds.currentUser,
    '/dashboard': () => responds.error(500, 'Internal Server Error'),
  })
  // Without retries: the app retries a 5xx twice, with a backoff past the
  // test's wait.
  const queryClient = createQueryClient()
  queryClient.setDefaultOptions({ queries: { retry: false } })

  renderRoute('/', queryClient)

  expect((await screen.findByRole('alert')).textContent).toBe('Internal Server Error')
})
