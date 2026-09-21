import { expect, test } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import {
  renderRoute,
  responds,
  stubApi,
  ticketDetail,
  ticketMessage,
  ticketSummary,
} from './helpers.tsx'

const thread = ticketDetail({
  id: 32,
  subject: 'Can I move my start date?',
  studentName: 'Jonas Berg',
  studentEmail: 'jonas@student.example',
  status: 'closed',
  category: 'general',
  summary: 'Moved from the March to the April cohort.',
  createdAt: '2026-08-30T15:55:00.000Z',
  updatedAt: '2026-08-31T15:55:00.000Z',
  messages: [
    ticketMessage({ id: 1, body: 'Can I join the April cohort?' }),
    ticketMessage({
      id: 2,
      body: 'You can move cohorts once, free of charge.',
      direction: 'outbound',
      author: 'ai',
    }),
    ticketMessage({
      id: 3,
      body: 'Done — you are in the April cohort.',
      direction: 'outbound',
      author: 'agent',
      agent: { id: 'u1', name: 'Gil Agent' },
    }),
  ],
})

const stubTicket = (detail = thread) =>
  stubApi({
    '/auth/me': responds.currentUser,
    [`/tickets/${String(detail.id)}`]: () => Response.json(detail),
  })

test('tells the student, the AI and the agent apart in the thread', async () => {
  stubTicket()

  renderRoute('/tickets/32')

  const messages = await screen.findAllByRole('article')
  expect(messages).toHaveLength(3)

  // Each message says in words who wrote it, so the three do not rely on
  // colour or position to be told apart.
  const [student, ai, agent] = messages as [HTMLElement, HTMLElement, HTMLElement]
  expect(student.getAttribute('aria-label')).toBe('Student message from Jonas Berg')
  expect(within(student).getByText('Student')).toBeTruthy()
  expect(within(student).getByText('Can I join the April cohort?')).toBeTruthy()

  expect(ai.getAttribute('aria-label')).toBe('AI message from AI assistant')
  expect(within(ai).getByText('AI')).toBeTruthy()

  expect(agent.getAttribute('aria-label')).toBe('Agent message from Gil Agent')
  expect(within(agent).getByText('Agent')).toBeTruthy()
  expect(within(agent).getByText('Gil Agent')).toBeTruthy()
})

test('shows the ticket above its thread', async () => {
  stubTicket()

  renderRoute('/tickets/32')

  expect(await screen.findByRole('heading', { name: 'Can I move my start date?' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'jonas@student.example' })).toHaveProperty(
    'href',
    'mailto:jonas%40student.example',
  )
  expect(screen.getByText('closed')).toBeTruthy()
  expect(screen.getByText('general')).toBeTruthy()
  expect(screen.getByText('Moved from the March to the April cohort.')).toBeTruthy()
  expect(screen.getByText('Opened:')).toBeTruthy()
})

test('pins each timestamp to the instant the API sent, whatever the reader sees', async () => {
  stubTicket()

  renderRoute('/tickets/32')
  await screen.findByRole('heading', { name: 'Can I move my start date?' })

  // The rendered text is the reader's own locale, deliberately, so the
  // machine-readable attribute is what a test can hold to.
  const stamps = document.querySelectorAll('time')
  expect([...stamps].map((stamp) => stamp.getAttribute('dateTime'))).toEqual([
    '2026-08-30T15:55:00.000Z',
    '2026-08-31T15:55:00.000Z',
    '2026-09-02T09:00:00.000Z',
    '2026-09-02T09:00:00.000Z',
    '2026-09-02T09:00:00.000Z',
  ])
  // And each one says something, rather than rendering an empty element.
  for (const stamp of stamps) expect(stamp.textContent).not.toBe('')
})

test('encodes the address in the mailto link', async () => {
  // An address carrying mail headers would otherwise open an agent's client
  // pre-addressed and pre-written. Nothing writes one today; Phase 4's webhook
  // will.
  stubTicket(
    ticketDetail({
      id: 11,
      subject: 'Header injection',
      studentName: null,
      studentEmail: 'victim@uni.test?to=attacker@evil.test&subject=Reset',
    }),
  )

  renderRoute('/tickets/11')

  const link = await screen.findByRole('link', {
    name: 'victim@uni.test?to=attacker@evil.test&subject=Reset',
  })
  expect(link.getAttribute('href')).toBe(
    'mailto:victim%40uni.test%3Fto%3Dattacker%40evil.test%26subject%3DReset',
  )
})

test('names the escalation and the auto-close date when there are any', async () => {
  stubTicket(
    ticketDetail({
      id: 7,
      subject: 'Refund please',
      status: 'resolved',
      needsAgent: true,
      escalationReason: 'refund_approval',
      autoCloseAt: '2026-10-03T13:55:00.000Z',
    }),
  )

  renderRoute('/tickets/7')

  expect(await screen.findByText('Needs agent: refund approval')).toBeTruthy()
  expect(screen.getByText('Closes automatically:')).toBeTruthy()
})

test('falls back to the address when the student sent no name', async () => {
  stubTicket(
    ticketDetail({
      id: 8,
      subject: 'No name',
      studentName: null,
      studentEmail: 'anon@student.example',
      messages: [ticketMessage({ id: 1, body: 'Hello' })],
    }),
  )

  renderRoute('/tickets/8')

  const message = await screen.findByRole('article')
  expect(message.getAttribute('aria-label')).toBe('Student message from anon@student.example')
})

test('says so when a ticket has no messages yet', async () => {
  stubTicket(ticketDetail({ id: 9, subject: 'Quiet one' }))

  renderRoute('/tickets/9')

  expect(await screen.findByText('This ticket has no messages yet.')).toBeTruthy()
})

test('shows not found for a ticket the API does not have', async () => {
  stubApi({
    '/auth/me': responds.currentUser,
    '/tickets/404': () => responds.error(404, 'Ticket not found'),
  })

  renderRoute('/tickets/404')

  expect(await screen.findByRole('heading', { name: 'Ticket not found' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Back to the ticket list' }).getAttribute('href')).toBe(
    '/tickets',
  )
})

test('shows not found for a malformed id without asking the API', async () => {
  const requests = stubApi({ '/auth/me': responds.currentUser })

  renderRoute('/tickets/abc')

  expect(await screen.findByRole('heading', { name: 'Ticket not found' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Back to the ticket list' }).getAttribute('href')).toBe(
    '/tickets',
  )
  expect(requests.some((request) => request.url.includes('/tickets'))).toBe(false)
})

test('shows another failure as an error, not as a missing ticket', async () => {
  stubApi({
    '/auth/me': responds.currentUser,
    '/tickets/5': () => responds.error(400, 'Invalid query'),
  })

  renderRoute('/tickets/5')

  expect((await screen.findByRole('alert')).textContent).toBe('Invalid query')
  expect(screen.queryByRole('heading', { name: 'Ticket not found' })).toBeNull()
})

test('opens a ticket from the list', async () => {
  const user = userEvent.setup()
  stubApi({
    '/auth/me': responds.currentUser,
    '/tickets': () =>
      Response.json({
        tickets: [ticketSummary({ id: 32, subject: 'Can I move my start date?' })],
        page: 1,
        pageSize: 20,
        total: 1,
      }),
    '/tickets/32': () => Response.json(thread),
  })

  const router = renderRoute('/tickets')

  await user.click(await screen.findByRole('link', { name: 'Can I move my start date?' }))

  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/tickets/32')
  })
  expect(await screen.findAllByRole('article')).toHaveLength(3)
})
