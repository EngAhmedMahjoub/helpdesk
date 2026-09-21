import { expect, test } from 'bun:test'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { TicketDetail, UpdateTicketRequest } from '@helpdesk/shared'
import {
  renderRoute,
  responds,
  stubApi,
  ticketDetail,
  ticketMessage,
  ticketSummary,
} from './helpers.tsx'

const open = ticketDetail({
  id: 26,
  subject: "Can't log in",
  status: 'open',
  category: null,
  messages: [ticketMessage({ id: 1, body: 'Cannot sign in' })],
})

/**
 * Answers the detail, and applies a PATCH to it the way the API would, so a
 * test can read the change back the way the page does.
 */
function stubTicket(initial: TicketDetail = open) {
  let ticket = initial
  const patches: UpdateTicketRequest[] = []
  const path = `/tickets/${String(initial.id)}`

  stubApi({
    '/auth/me': responds.currentUser,
    [path]: async (request) => {
      if (request.method !== 'PATCH') return Response.json(ticket)
      const changes = (await request.clone().json()) as UpdateTicketRequest
      patches.push(changes)
      ticket = {
        ...ticket,
        ...changes,
        ...(changes.needsAgent === false && { needsAgent: false, escalationReason: null }),
      }
      return Response.json(ticket)
    },
  })

  return { patches, current: () => ticket }
}

const trigger = (label: string) => screen.getByLabelText(label)

test('an agent changes the status, and the page shows what the API stored', async () => {
  const user = userEvent.setup()
  const { patches, current } = stubTicket()

  renderRoute('/tickets/26')
  await waitFor(() => {
    expect(trigger('Status').textContent).toContain('open')
  })

  await user.click(trigger('Status'))
  await user.click(await screen.findByRole('option', { name: 'resolved' }))

  await waitFor(() => {
    expect(patches).toEqual([{ status: 'resolved' }])
  })
  expect(current().status).toBe('resolved')
  await waitFor(() => {
    expect(trigger('Status').textContent).toContain('resolved')
  })
})

test('an agent classifies an unclassified ticket', async () => {
  const user = userEvent.setup()
  const { patches } = stubTicket()

  renderRoute('/tickets/26')
  // Null category reads as a placeholder, not as a value: a ticket can be
  // classified, but the API takes nothing back to unclassified.
  await waitFor(() => {
    expect(trigger('Category').textContent).toContain('unclassified')
  })

  await user.click(trigger('Category'))
  await user.click(await screen.findByRole('option', { name: 'technical' }))

  await waitFor(() => {
    expect(patches).toEqual([{ category: 'technical' }])
  })
  await waitFor(() => {
    expect(trigger('Category').textContent).toContain('technical')
  })
})

test('a refused classification leaves the select reading unclassified', async () => {
  const user = userEvent.setup()
  stubApi({
    '/auth/me': responds.currentUser,
    '/tickets/26': (request) =>
      request.method === 'PATCH'
        ? responds.error(400, 'Invalid request body')
        : Response.json(open),
  })

  renderRoute('/tickets/26')
  await waitFor(() => {
    expect(trigger('Category').textContent).toContain('unclassified')
  })

  await user.click(trigger('Category'))
  await user.click(await screen.findByRole('option', { name: 'technical' }))

  expect((await screen.findByRole('alert')).textContent).toBe('Invalid request body')
  // The API refused, so the ticket is still unclassified and the select has to
  // say so rather than keep the word that was clicked.
  expect(trigger('Category').textContent).toContain('unclassified')
})

test('unclassified is offered but cannot be chosen: there is no way back', async () => {
  const user = userEvent.setup()
  const { patches } = stubTicket()

  renderRoute('/tickets/26')
  await waitFor(() => {
    expect(trigger('Category')).toBeTruthy()
  })

  await user.click(trigger('Category'))
  const unclassified = await screen.findByRole('option', { name: 'unclassified' })
  expect(unclassified.getAttribute('aria-disabled')).toBe('true')

  await user.click(unclassified)

  expect(patches).toEqual([])
})

test('a classified ticket is not offered unclassified at all', async () => {
  const user = userEvent.setup()
  stubTicket(ticketDetail({ id: 26, subject: 'Classified', category: 'refund' }))

  renderRoute('/tickets/26')
  await waitFor(() => {
    expect(trigger('Category').textContent).toContain('refund')
  })

  await user.click(trigger('Category'))
  await screen.findByRole('option', { name: 'technical' })

  expect(screen.queryByRole('option', { name: 'unclassified' })).toBeNull()
})

test('a change survives a reload, because the API kept it', async () => {
  const user = userEvent.setup()
  const { current } = stubTicket()

  renderRoute('/tickets/26')
  await waitFor(() => {
    expect(trigger('Status').textContent).toContain('open')
  })
  await user.click(trigger('Status'))
  await user.click(await screen.findByRole('option', { name: 'closed' }))
  await waitFor(() => {
    expect(current().status).toBe('closed')
  })

  // A fresh mount with a fresh cache is what a reload gives the page.
  cleanup()
  renderRoute('/tickets/26')

  await waitFor(() => {
    expect(trigger('Status').textContent).toContain('closed')
  })
})

test('clearing Needs agent takes the escalation reason with it', async () => {
  const user = userEvent.setup()
  const { patches } = stubTicket(
    ticketDetail({
      id: 26,
      subject: 'Refund please',
      needsAgent: true,
      escalationReason: 'refund_approval',
    }),
  )

  renderRoute('/tickets/26')
  expect(await screen.findByText('Needs agent: refund approval')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Clear' }))

  await waitFor(() => {
    expect(patches).toEqual([{ needsAgent: false }])
  })
  await waitFor(() => {
    expect(screen.queryByText(/Needs agent/)).toBeNull()
  })
})

test('a ticket nobody escalated offers nothing to clear', async () => {
  stubTicket()

  renderRoute('/tickets/26')
  await screen.findByLabelText('Status')

  expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
})

test('a refused change is shown, and the control keeps the stored value', async () => {
  const user = userEvent.setup()
  stubApi({
    '/auth/me': responds.currentUser,
    '/tickets/26': (request) =>
      request.method === 'PATCH'
        ? responds.error(400, 'Invalid request body')
        : Response.json(open),
  })

  renderRoute('/tickets/26')
  await waitFor(() => {
    expect(trigger('Status').textContent).toContain('open')
  })

  await user.click(trigger('Status'))
  await user.click(await screen.findByRole('option', { name: 'resolved' }))

  expect((await screen.findByRole('alert')).textContent).toBe('Invalid request body')
  expect(trigger('Status').textContent).toContain('open')
})

test('a changed ticket does not sit stale in the list behind it', async () => {
  const user = userEvent.setup()
  let status: 'open' | 'closed' = 'open'
  const listCalls: string[] = []

  stubApi({
    '/auth/me': responds.currentUser,
    '/tickets': (request) => {
      listCalls.push(request.url)
      return Response.json({
        tickets: [ticketSummary({ id: 26, subject: "Can't log in", status })],
        page: 1,
        pageSize: 20,
        total: 1,
      })
    },
    '/tickets/26': async (request) => {
      if (request.method === 'PATCH') {
        status = ((await request.clone().json()) as { status: typeof status }).status
      }
      return Response.json({ ...open, status })
    },
  })

  // Start on the list, so its query is in the cache to go stale.
  const router = renderRoute('/tickets')
  expect(await screen.findByRole('cell', { name: 'open' })).toBeTruthy()
  const before = listCalls.length

  await user.click(screen.getByRole('link', { name: "Can't log in" }))
  await waitFor(() => {
    expect(trigger('Status')).toBeTruthy()
  })
  await user.click(trigger('Status'))
  await user.click(await screen.findByRole('option', { name: 'closed' }))
  await waitFor(() => {
    expect(trigger('Status').textContent).toContain('closed')
  })

  await user.click(screen.getByRole('link', { name: 'All tickets' }))
  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/tickets')
  })

  // The list was invalidated by the change, so it asked again rather than
  // showing the status it had cached.
  expect(listCalls.length).toBeGreaterThan(before)
  expect(await screen.findByRole('cell', { name: 'closed' })).toBeTruthy()
})
