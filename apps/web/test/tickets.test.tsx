import { expect, test } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { TicketListResponse, TicketSummary } from '@helpdesk/shared'
import { renderRoute, responds, stubApi, ticketSummary } from './helpers.tsx'

const tickets: TicketSummary[] = [
  ticketSummary({
    id: 1,
    subject: 'Refund for the bootcamp',
    studentName: 'Lena Fischer',
    category: 'refund',
    needsAgent: true,
    escalationReason: 'refund_approval',
    updatedAt: '2026-09-19T16:07:00.000Z',
  }),
  ticketSummary({
    id: 2,
    subject: 'Videos will not play',
    studentName: null,
    studentEmail: 'tom@student.example',
    status: 'resolved',
    category: 'technical',
    updatedAt: '2026-09-17T14:55:00.000Z',
  }),
]

/** Answers the list, recording the query each request carried. */
function stubTickets(page: (query: URLSearchParams) => TicketListResponse) {
  const queries: URLSearchParams[] = []
  const requests = stubApi({
    '/auth/me': responds.currentUser,
    '/tickets': (request) => {
      const query = new URL(request.url).searchParams
      queries.push(query)
      return Response.json(page(query))
    },
  })
  return { queries, requests }
}

const listOf = (rows: TicketSummary[], extra: Partial<TicketListResponse> = {}) => ({
  tickets: rows,
  page: 1,
  pageSize: 20,
  total: rows.length,
  ...extra,
})

test('shows the tickets the API returned', async () => {
  stubTickets(() => listOf(tickets))

  renderRoute('/tickets')

  const row = within(
    (await screen.findByRole('cell', { name: 'Refund for the bootcamp' })).closest('tr')!,
  )
  expect(row.getByRole('cell', { name: 'Lena Fischer' })).toBeTruthy()
  expect(row.getByRole('cell', { name: 'open' })).toBeTruthy()
  expect(row.getByRole('cell', { name: 'refund' })).toBeTruthy()
  expect(row.getByRole('cell', { name: 'Yes' })).toBeTruthy()

  // No name on the second ticket, so the address stands in for one.
  expect(await screen.findByRole('cell', { name: 'tom@student.example' })).toBeTruthy()
})

test('asks for the filters, sort and page in the URL', async () => {
  const { queries } = stubTickets(() => listOf(tickets, { page: 2, pageSize: 2, total: 6 }))

  renderRoute('/tickets?status=open&category=refund&sort=createdAt&order=asc&page=2&pageSize=2')

  await screen.findByRole('table')
  expect(Object.fromEntries(queries[0]!)).toEqual({
    status: 'open',
    category: 'refund',
    sort: 'createdAt',
    order: 'asc',
    page: '2',
    pageSize: '2',
  })
})

test('falls back to the default list when the URL asks for something impossible', async () => {
  const { queries } = stubTickets(() => listOf(tickets))

  renderRoute('/tickets?status=bogus&page=0')

  await screen.findByRole('table')
  expect(Object.fromEntries(queries[0]!)).toEqual({
    sort: 'updatedAt',
    order: 'desc',
    page: '1',
    pageSize: '20',
  })
})

test('choosing a status filters the list and puts it in the URL', async () => {
  const user = userEvent.setup()
  const { queries } = stubTickets((query) =>
    listOf(query.get('status') === 'resolved' ? [tickets[1]!] : tickets),
  )

  const router = renderRoute('/tickets')
  await screen.findByRole('table')

  await user.click(screen.getByLabelText('Status'))
  await user.click(await screen.findByRole('option', { name: 'resolved' }))

  await waitFor(() => {
    expect(screen.queryByRole('cell', { name: 'Refund for the bootcamp' })).toBeNull()
  })
  expect(screen.getByRole('cell', { name: 'Videos will not play' })).toBeTruthy()
  expect(queries.at(-1)?.get('status')).toBe('resolved')
  expect(new URLSearchParams(router.state.location.search).get('status')).toBe('resolved')
})

test('choosing a sort re-asks the API in that order', async () => {
  const user = userEvent.setup()
  const { queries } = stubTickets(() => listOf(tickets))

  renderRoute('/tickets')
  await screen.findByRole('table')

  await user.click(screen.getByLabelText('Sort by'))
  await user.click(await screen.findByRole('option', { name: 'Oldest ticket' }))

  await waitFor(() => {
    expect(queries.at(-1)?.get('sort')).toBe('createdAt')
  })
  expect(queries.at(-1)?.get('order')).toBe('asc')
})

test('pages forward and back, and a filter returns to page one', async () => {
  const user = userEvent.setup()
  const { queries } = stubTickets((query) =>
    listOf(tickets, { page: Number(query.get('page') ?? 1), pageSize: 2, total: 6 }),
  )

  renderRoute('/tickets?pageSize=2')
  expect(await screen.findByText('Showing 1–2 of 6')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Next' }))
  expect(await screen.findByText('Showing 3–4 of 6')).toBeTruthy()
  expect(queries.at(-1)?.get('page')).toBe('2')

  // Page 1 is cached and still fresh, so going back shows it without asking
  // the API again — which is the point of keying the cache by the query.
  await user.click(screen.getByRole('button', { name: 'Previous' }))
  expect(await screen.findByText('Showing 1–2 of 6')).toBeTruthy()

  // Back on page 2, a filter change starts again at the first page.
  await user.click(screen.getByRole('button', { name: 'Next' }))
  expect(await screen.findByText('Showing 3–4 of 6')).toBeTruthy()
  await user.click(screen.getByLabelText('Category'))
  await user.click(await screen.findByRole('option', { name: 'technical' }))
  await waitFor(() => {
    expect(queries.at(-1)?.get('category')).toBe('technical')
  })
  expect(queries.at(-1)?.get('page')).toBe('1')
})

test('changing rows per page re-asks from the first page', async () => {
  const user = userEvent.setup()
  const { queries } = stubTickets((query) =>
    listOf(tickets, {
      page: Number(query.get('page') ?? 1),
      pageSize: Number(query.get('pageSize') ?? 20),
      total: 60,
    }),
  )

  renderRoute('/tickets?pageSize=10&page=3')
  expect(await screen.findByText('Showing 21–22 of 60')).toBeTruthy()

  await user.click(screen.getByLabelText('Rows per page'))
  await user.click(await screen.findByRole('option', { name: '50' }))

  await waitFor(() => {
    expect(queries.at(-1)?.get('pageSize')).toBe('50')
  })
  // Page 3 of ten-row pages is past the end of fifty-row ones.
  expect(queries.at(-1)?.get('page')).toBe('1')
})

test('offers a page size the URL asked for, even one not on the menu', async () => {
  const user = userEvent.setup()
  stubTickets((query) =>
    listOf(tickets, { pageSize: Number(query.get('pageSize') ?? 20), total: 7 }),
  )

  renderRoute('/tickets?pageSize=7')
  await screen.findByRole('table')

  await user.click(screen.getByLabelText('Rows per page'))

  expect(await screen.findByRole('option', { name: '7' })).toBeTruthy()
  expect(screen.getByRole('option', { name: '10' })).toBeTruthy()
})

test('says so when no ticket matches', async () => {
  stubTickets(() => listOf([]))

  renderRoute('/tickets')

  expect(await screen.findByText('No tickets match these filters.')).toBeTruthy()
  expect(screen.queryByRole('table')).toBeNull()
})

test('shows the API error rather than an empty table', async () => {
  // A 4xx, which the query client does not retry: a 500 would only reach the
  // screen after its retries, long after this test gives up waiting.
  stubApi({
    '/auth/me': responds.currentUser,
    '/tickets': () => responds.error(400, 'Invalid query'),
  })

  renderRoute('/tickets')

  expect((await screen.findByRole('alert')).textContent).toBe('Invalid query')
  expect(screen.queryByRole('table')).toBeNull()
})
