import { expect, test } from 'bun:test'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { TicketListResponse, TicketSummary } from '@helpdesk/shared'
import { currentUserQueryKey } from '../src/lib/auth.ts'
import { createQueryClient } from '../src/lib/query-client.ts'
import { ticketsQueryKey } from '../src/lib/tickets.ts'
import {
  agentUser,
  renderRoute,
  responds,
  signedInUser,
  stubApi,
  ticketSummary,
} from './helpers.tsx'

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
  // The reason, not a bare Yes (6.7).
  expect(row.getByRole('cell', { name: 'refund approval' })).toBeTruthy()

  // No name on the second ticket, so the address stands in for one.
  expect(await screen.findByRole('cell', { name: 'tom@student.example' })).toBeTruthy()
})

test('an unclassified ticket nobody escalated shows a dash and No', async () => {
  stubTickets(() => listOf([ticketSummary({ id: 3, subject: 'Where are my slides' })]))

  renderRoute('/tickets')

  const row = within(
    (await screen.findByRole('cell', { name: 'Where are my slides' })).closest('tr')!,
  )
  // A dash rather than an empty cell: nothing has classified it yet.
  expect(row.getByRole('cell', { name: '—' })).toBeTruthy()
  expect(row.getByRole('cell', { name: 'No' })).toBeTruthy()
})

test('an agent sees the ticket list', async () => {
  stubApi({
    '/auth/me': responds.currentAgent,
    '/tickets': () => Response.json(listOf(tickets)),
  })

  const router = renderRoute('/tickets')

  expect(await screen.findByRole('cell', { name: 'Refund for the bootcamp' })).toBeTruthy()
  expect(router.state.location.pathname).toBe('/tickets')
})

test('names who holds each ticket, and says so when nobody does', async () => {
  stubTickets(() =>
    listOf([
      ticketSummary({ id: 4, subject: 'Held one', assignee: { id: 'gil', name: 'Gil Agent' } }),
      ticketSummary({ id: 5, subject: 'Loose one' }),
    ]),
  )

  renderRoute('/tickets')

  const held = within((await screen.findByRole('cell', { name: 'Held one' })).closest('tr')!)
  expect(held.getByRole('cell', { name: 'Gil Agent' })).toBeTruthy()
  const loose = within(screen.getByRole('cell', { name: 'Loose one' }).closest('tr')!)
  expect(loose.getByRole('cell', { name: 'Unassigned' })).toBeTruthy()
})

test('one agent’s assignee=me list is not served to the next', async () => {
  // The cache is cleared on sign-in and sign-out, so this cannot happen today.
  // The key carries the viewer so that it stays impossible if some later way
  // of changing user skips that clearing.
  const client = createQueryClient()
  const mine = (subject: string) => listOf([ticketSummary({ id: 1, subject })])

  stubApi({ '/auth/me': responds.currentUser, '/tickets': () => Response.json(mine('Ada’s own')) })
  renderRoute('/tickets?assignee=me', client)
  expect(await screen.findByRole('cell', { name: 'Ada’s own' })).toBeTruthy()

  cleanup()
  stubApi({ '/auth/me': responds.currentAgent, '/tickets': () => Response.json(mine('Gil’s own')) })
  // The case this key guards: the viewer changes and nothing clears the cache.
  client.setQueryData(currentUserQueryKey, agentUser)
  renderRoute('/tickets?assignee=me', client)
  expect(await screen.findByRole('cell', { name: 'Gil’s own' })).toBeTruthy()

  const query = { assignee: 'me', sort: 'updatedAt', order: 'desc', page: 1, pageSize: 20 } as const
  const entry = (id: string) =>
    client.getQueryData<TicketListResponse>(ticketsQueryKey(query, id))?.tickets[0]?.subject
  // Two entries, each holding its own agent's list.
  expect(entry(signedInUser.id)).toBe('Ada’s own')
  expect(entry(agentUser.id)).toBe('Gil’s own')
})

test('asks for the filters, sort and page in the URL', async () => {
  const { queries } = stubTickets(() => listOf(tickets, { page: 2, pageSize: 2, total: 6 }))

  renderRoute(
    '/tickets?status=open&category=refund&assignee=me&sort=createdAt&order=asc&page=2&pageSize=2',
  )

  await screen.findByRole('table')
  expect(Object.fromEntries(queries[0]!)).toEqual({
    status: 'open',
    category: 'refund',
    assignee: 'me',
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

test('choosing All drops the status and keeps the category', async () => {
  const user = userEvent.setup()
  const { queries } = stubTickets(() => listOf(tickets))

  const router = renderRoute('/tickets?status=open&category=technical')
  await screen.findByRole('table')

  await user.click(screen.getByLabelText('Status'))
  await user.click(await screen.findByRole('option', { name: 'All' }))

  await waitFor(() => {
    expect(queries.at(-1)?.has('status')).toBe(false)
  })
  expect(queries.at(-1)?.get('category')).toBe('technical')
  const search = new URLSearchParams(router.state.location.search)
  expect(search.has('status')).toBe(false)
  expect(search.get('category')).toBe('technical')
})

test('the Assignee filter narrows the list to mine or to unassigned, and lives in the URL', async () => {
  const user = userEvent.setup()
  const { queries } = stubTickets(() => listOf(tickets))

  const router = renderRoute('/tickets?category=refund')
  await screen.findByRole('table')
  const search = () => new URLSearchParams(router.state.location.search)

  for (const [label, value] of [
    ['Assigned to me', 'me'],
    ['Unassigned', 'none'],
  ] as const) {
    await user.click(screen.getByLabelText('Assignee'))
    await user.click(await screen.findByRole('option', { name: label }))

    await waitFor(() => {
      expect(queries.at(-1)?.get('assignee')).toBe(value)
    })
    expect(search().get('assignee')).toBe(value)
    // The other filters stay: this one narrows them, it does not replace them.
    expect(queries.at(-1)?.get('category')).toBe('refund')
  }

  // Anyone takes the filter off, and the parameter with it.
  await user.click(screen.getByLabelText('Assignee'))
  await user.click(await screen.findByRole('option', { name: 'Anyone' }))
  await waitFor(() => {
    expect(search().has('assignee')).toBe(false)
  })
  expect(search().get('category')).toBe('refund')
})

test('each escalation reason reads as its own badge in the list', async () => {
  const flagged = (id: number, escalationReason: TicketSummary['escalationReason']) =>
    ticketSummary({ id, subject: `Ticket ${String(id)}`, needsAgent: true, escalationReason })
  stubTickets(() =>
    listOf([
      flagged(11, 'refund_approval'),
      flagged(12, 'ai_failed'),
      flagged(13, 'unverified_sender'),
      flagged(14, 'auto_reply_limit'),
      // Flagged before reasons were recorded.
      flagged(15, null),
    ]),
  )

  renderRoute('/tickets')

  for (const [subject, label] of [
    ['Ticket 11', 'refund approval'],
    ['Ticket 12', 'AI could not answer'],
    ['Ticket 13', 'sender not verified'],
    ['Ticket 14', 'AI reply limit reached'],
    ['Ticket 15', 'Yes'],
  ]) {
    const row = within((await screen.findByRole('cell', { name: subject })).closest('tr')!)
    expect(row.getByRole('cell', { name: label })).toBeTruthy()
  }
})

test('the Needs agent filter narrows the list either way, and lives in the URL', async () => {
  const user = userEvent.setup()
  const { queries } = stubTickets(() => listOf(tickets))

  const router = renderRoute('/tickets?status=open')
  await screen.findByRole('table')
  const search = () => new URLSearchParams(router.state.location.search)

  for (const [label, value] of [
    ['Needs agent', 'true'],
    ['No agent needed', 'false'],
  ] as const) {
    await user.click(screen.getByLabelText('Needs agent'))
    await user.click(await screen.findByRole('option', { name: label }))

    await waitFor(() => {
      expect(queries.at(-1)?.get('needsAgent')).toBe(value)
    })
    expect(search().get('needsAgent')).toBe(value)
    // It narrows the other filters rather than replacing them.
    expect(queries.at(-1)?.get('status')).toBe('open')
  }

  // All takes the filter off, and the parameter with it.
  await user.click(screen.getByLabelText('Needs agent'))
  await user.click(await screen.findByRole('option', { name: 'All' }))
  await waitFor(() => {
    expect(search().has('needsAgent')).toBe(false)
  })
})

test('a link to the needs-agent list opens with the filter applied', async () => {
  const { queries } = stubTickets(() => listOf(tickets))

  renderRoute('/tickets?needsAgent=true')
  await screen.findByRole('table')

  expect(queries.at(-1)?.get('needsAgent')).toBe('true')
})

test('each sort option asks for its column and direction', async () => {
  const user = userEvent.setup()
  const { queries } = stubTickets(() => listOf(tickets))

  const router = renderRoute('/tickets')
  await screen.findByRole('table')

  // Latest activity last: it is the default, so choosing it first changes nothing.
  const choices = [
    ['Oldest activity', 'updatedAt', 'asc'],
    ['Newest ticket', 'createdAt', 'desc'],
    ['Oldest ticket', 'createdAt', 'asc'],
    ['Latest activity', 'updatedAt', 'desc'],
  ] as const

  for (const [label, sort, order] of choices) {
    await user.click(screen.getByLabelText('Sort by'))
    await user.click(await screen.findByRole('option', { name: label }))

    await waitFor(() => {
      const search = new URLSearchParams(router.state.location.search)
      expect([search.get('sort'), search.get('order')]).toEqual([sort, order])
    })
  }

  // Asked for once each. Latest activity was the first request, and coming
  // back to it is served from the cache rather than asked for again.
  const asked = queries.map((query) => `${query.get('sort')}:${query.get('order')}`)
  expect(asked).toEqual(['updatedAt:desc', 'updatedAt:asc', 'createdAt:desc', 'createdAt:asc'])
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
