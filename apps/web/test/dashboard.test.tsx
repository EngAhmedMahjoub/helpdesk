import { describe, expect, test } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { createQueryClient } from '../src/lib/query-client.ts'
import type { TicketListResponse } from '@helpdesk/shared'
import {
  dashboardCounts,
  renderRoute,
  responds,
  rowFor,
  stubApi,
  ticketSummary,
} from './helpers.tsx'

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
    '/tickets': responds.noTickets,
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
    '/tickets': responds.noTickets,
  })

  renderRoute('/')

  const status = (await screen.findByText('Loading the dashboard')).closest('[role="status"]')
  expect(status?.getAttribute('aria-busy')).toBe('true')
})

test('shows the error when the counts cannot be loaded', async () => {
  stubApi({
    '/auth/me': responds.currentUser,
    '/dashboard': () => responds.error(500, 'Internal Server Error'),
    '/tickets': responds.noTickets,
  })
  // Without retries: the app retries a 5xx twice, with a backoff past the
  // test's wait.
  const queryClient = createQueryClient()
  queryClient.setDefaultOptions({ queries: { retry: false } })

  renderRoute('/', queryClient)

  expect((await screen.findByRole('alert')).textContent).toBe('Internal Server Error')
})

describe('recent tickets', () => {
  const recent: TicketListResponse = {
    tickets: [
      ticketSummary({
        id: 12,
        subject: 'Certificate has the wrong name',
        studentName: 'Lena Fischer',
        createdAt: '2026-10-01T15:30:00.000Z',
      }),
      ticketSummary({
        id: 11,
        subject: 'Videos will not play',
        studentName: null,
        studentEmail: 'tom@student.example',
        status: 'resolved',
        createdAt: '2026-09-30T08:00:00.000Z',
      }),
    ],
    page: 1,
    pageSize: 5,
    total: 2,
  }

  test('asks for the five newest tickets and lists them with links', async () => {
    const requests = stubApi({
      '/auth/me': responds.currentUser,
      '/dashboard': responds.dashboard,
      '/tickets': () => Response.json(recent),
    })

    renderRoute('/')

    const newest = await rowFor('Certificate has the wrong name')
    expect(newest.getByRole('link').getAttribute('href')).toBe('/tickets/12')
    expect(newest.getByRole('cell', { name: 'Lena Fischer' })).toBeTruthy()
    expect(newest.getByRole('cell', { name: 'open' })).toBeTruthy()
    // No name on the email, so the address stands in, as on the list.
    const older = await rowFor('Videos will not play')
    expect(older.getByRole('cell', { name: 'tom@student.example' })).toBeTruthy()
    expect(older.getByRole('cell', { name: 'resolved' })).toBeTruthy()

    const query = new URL(requests.find((r) => new URL(r.url).pathname === '/api/tickets')!.url)
      .searchParams
    expect(Object.fromEntries(query)).toEqual({
      sort: 'createdAt',
      order: 'desc',
      pageSize: '5',
    })
  })

  test('a subject opens its ticket', async () => {
    stubApi({
      '/auth/me': responds.currentUser,
      '/dashboard': responds.dashboard,
      '/tickets': () => Response.json(recent),
    })

    const router = renderRoute('/')
    await userEvent
      .setup()
      .click(await screen.findByRole('link', { name: 'Certificate has the wrong name' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/tickets/12'))
  })

  test('View all opens the full list, newest first', async () => {
    stubApi({
      '/auth/me': responds.currentUser,
      '/dashboard': responds.dashboard,
      '/tickets': () => Response.json(recent),
    })

    const router = renderRoute('/')
    await userEvent.setup().click(await screen.findByRole('link', { name: 'View all tickets' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/tickets'))
    expect(router.state.location.search).toBe('?sort=createdAt&order=desc')
  })

  test('says so when there are no tickets yet', async () => {
    stubApi({
      '/auth/me': responds.currentUser,
      '/dashboard': responds.dashboard,
      '/tickets': responds.noTickets,
    })

    renderRoute('/')

    expect(await screen.findByText('No tickets yet.')).toBeDefined()
  })

  test('a failed list shows its error and leaves the counts in place', async () => {
    stubApi({
      '/auth/me': responds.currentUser,
      '/dashboard': responds.dashboard,
      '/tickets': () => responds.error(403, 'Forbidden'),
    })

    renderRoute('/')

    const region = await screen.findByRole('region', { name: 'Recent tickets' })
    expect((await within(region).findByRole('alert')).textContent).toBe('Forbidden')
    // The counts are not taken down with it.
    expect(await screen.findByText('Needs an agent')).toBeDefined()
  })
})
