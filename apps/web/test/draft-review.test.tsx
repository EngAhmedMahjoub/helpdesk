import { expect, test } from 'bun:test'
import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ApproveDraftRequest, TicketDetail } from '@helpdesk/shared'
import { renderRoute, responds, stubApi, ticketDetail, ticketMessage } from './helpers.tsx'

const waiting = ticketDetail({
  id: 40,
  subject: 'Refund',
  studentName: 'Maya Chen',
  needsAgent: true,
  escalationReason: 'refund_approval',
  messages: [ticketMessage({ id: 1, body: 'I withdrew in week 1. Refund please.' })],
  pendingDraft: {
    id: 7,
    body: 'Your request has been passed to the team.',
    createdAt: '2026-09-30T09:00:00.000Z',
  },
})

/**
 * Answers the ticket, and reviews its draft the way the API would: once
 * reviewed, the ticket comes back with no draft and no escalation.
 */
function stubReview({
  ticket = waiting,
  onApprove,
}: { ticket?: TicketDetail; onApprove?: () => Response } = {}) {
  let stored = ticket
  const approved: ApproveDraftRequest[] = []
  const rejected: number[] = []
  const reviewed = () => {
    stored = { ...stored, pendingDraft: null, needsAgent: false, escalationReason: null }
  }

  const requests = stubApi({
    '/auth/me': responds.currentUser,
    '/tickets/40': () => Response.json(stored),
    '/drafts/7/approve': async (request) => {
      const failure = onApprove?.()
      if (failure) return failure
      approved.push((await request.clone().json()) as ApproveDraftRequest)
      reviewed()
      return Response.json({ id: 7, status: 'approved' })
    },
    '/drafts/7/reject': () => {
      rejected.push(7)
      stored = { ...stored, pendingDraft: null }
      return Response.json({ id: 7, status: 'rejected' })
    },
  })

  return { approved, rejected, requests }
}

const box = () => screen.findByLabelText('Draft reply to Maya Chen')

test("shows the AI's draft in an editable box, saying nothing has been sent", async () => {
  stubReview()

  renderRoute('/tickets/40')

  expect(((await box()) as HTMLTextAreaElement).value).toBe(
    'Your request has been passed to the team.',
  )
  expect(screen.getByRole('heading', { name: /Draft reply awaiting review/ })).toBeTruthy()
  expect(screen.getByText(/Nothing has been sent/)).toBeTruthy()
})

test('an agent approves an edited draft, and the panel goes away', async () => {
  const user = userEvent.setup()
  const { approved } = stubReview()

  renderRoute('/tickets/40')
  const draft = await box()
  await user.clear(draft)
  await user.type(draft, 'Approved: your refund will reach you within 10 days.')
  await user.click(screen.getByRole('button', { name: 'Approve and send' }))

  await waitFor(() => {
    expect(screen.queryByLabelText('Draft reply to Maya Chen')).toBeNull()
  })
  expect(approved).toEqual([{ body: 'Approved: your refund will reach you within 10 days.' }])
  // Announced from the region that outlives the panel.
  expect((await screen.findByText('Reply sent to Maya Chen.')).getAttribute('role')).toBe('status')
})

test('rejecting sends nothing to approve, and the panel goes away', async () => {
  const user = userEvent.setup()
  const { approved, rejected } = stubReview()

  renderRoute('/tickets/40')
  await box()
  await user.click(screen.getByRole('button', { name: 'Reject' }))

  await waitFor(() => {
    expect(screen.queryByLabelText('Draft reply to Maya Chen')).toBeNull()
  })
  expect(rejected).toEqual([7])
  expect(approved).toHaveLength(0)
})

test('an emptied box is refused here, before anything is sent', async () => {
  const user = userEvent.setup()
  const { approved } = stubReview()

  renderRoute('/tickets/40')
  await user.clear(await box())
  await user.click(screen.getByRole('button', { name: 'Approve and send' }))

  expect(await screen.findByText('Write a reply')).toBeTruthy()
  expect(approved).toHaveLength(0)
})

test("a send the API couldn't make keeps the draft and the edit, and says why", async () => {
  const user = userEvent.setup()
  stubReview({
    onApprove: () => responds.error(502, 'The reply could not be sent. Please try again.'),
  })

  renderRoute('/tickets/40')
  const draft = await box()
  await user.type(draft, ' Thanks.')
  await user.click(screen.getByRole('button', { name: 'Approve and send' }))

  expect((await screen.findByRole('alert')).textContent).toBe(
    'The reply could not be sent. Please try again.',
  )
  expect(((await box()) as HTMLTextAreaElement).value).toBe(
    'Your request has been passed to the team. Thanks.',
  )
})

test('warns when the sender was not verified, before anyone approves', async () => {
  stubReview({ ticket: { ...waiting, senderVerified: false } })

  renderRoute('/tickets/40')
  await box()

  expect(screen.getByText(/address was not verified, so it may be forged/)).toBeTruthy()
})

test('shows no panel on a ticket with no draft waiting', async () => {
  stubReview({ ticket: { ...waiting, pendingDraft: null } })

  renderRoute('/tickets/40')
  await screen.findByRole('heading', { name: 'Refund' })

  expect(screen.queryByRole('heading', { name: /Draft reply awaiting review/ })).toBeNull()
})
