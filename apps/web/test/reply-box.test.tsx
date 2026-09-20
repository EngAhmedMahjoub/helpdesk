import { expect, test } from 'bun:test'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { CreateReplyRequest, TicketDetail, TicketMessage } from '@helpdesk/shared'
import { renderRoute, responds, stubApi, ticketDetail, ticketMessage } from './helpers.tsx'

const ticket = ticketDetail({
  id: 26,
  subject: "Can't log in",
  studentName: 'Maya Chen',
  messages: [ticketMessage({ id: 1, body: 'My details are wrong' })],
})

/** Answers the detail, and stores a reply the way the API would. */
function stubTicket(onReply?: () => Response) {
  let stored: TicketDetail = ticket
  const sent: CreateReplyRequest[] = []

  stubApi({
    '/auth/me': responds.currentUser,
    '/tickets/26': () => Response.json(stored),
    '/tickets/26/replies': async (request) => {
      const body = (await request.clone().json()) as CreateReplyRequest
      const failure = onReply?.()
      if (failure) return failure

      sent.push(body)
      const message: TicketMessage = {
        id: 99,
        direction: 'outbound',
        author: 'agent',
        agent: { id: 'u1', name: 'Ada Admin' },
        body: body.body,
        createdAt: '2026-09-20T22:35:00.000Z',
      }
      stored = { ...stored, messages: [...stored.messages, message] }
      return Response.json(message, { status: 201 })
    },
  })

  return { sent, stored: () => stored }
}

const box = () => screen.getByLabelText('Reply to Maya Chen')
const send = () => screen.getByRole('button', { name: 'Send reply' })

test('a reply appears in the thread, and the box empties', async () => {
  const user = userEvent.setup()
  const { sent } = stubTicket()

  renderRoute('/tickets/26')
  await waitFor(() => {
    expect(box()).toBeTruthy()
  })

  await user.type(box(), 'I have reset your password.')
  await user.click(send())

  await waitFor(async () => {
    expect(await screen.findAllByRole('article')).toHaveLength(2)
  })
  const added = (await screen.findAllByRole('article'))[1]!
  expect(added.getAttribute('aria-label')).toBe('Agent message from Ada Admin')
  expect(within(added).getByText('I have reset your password.')).toBeTruthy()

  expect(sent).toEqual([{ body: 'I have reset your password.' }])
  expect((box() as HTMLTextAreaElement).value).toBe('')
  expect(await screen.findByText('Reply added to the thread.')).toBeTruthy()
})

test('the reply is still there after a remount, because the API kept it', async () => {
  const user = userEvent.setup()
  stubTicket()

  renderRoute('/tickets/26')
  await waitFor(() => {
    expect(box()).toBeTruthy()
  })
  await user.type(box(), 'Saved for later.')
  await user.click(send())
  await waitFor(async () => {
    expect(await screen.findAllByRole('article')).toHaveLength(2)
  })

  cleanup()
  renderRoute('/tickets/26')

  const messages = await screen.findAllByRole('article')
  expect(messages).toHaveLength(2)
  expect(messages[1]?.textContent).toContain('Saved for later.')
})

test('an empty reply is refused before any request', async () => {
  const user = userEvent.setup()
  const { sent } = stubTicket()

  renderRoute('/tickets/26')
  await waitFor(() => {
    expect(box()).toBeTruthy()
  })

  await user.click(send())

  expect(await screen.findByText('Write a reply')).toBeTruthy()
  expect(sent).toEqual([])
  expect(await screen.findAllByRole('article')).toHaveLength(1)
})

test('a reply of only whitespace is refused too', async () => {
  const user = userEvent.setup()
  const { sent } = stubTicket()

  renderRoute('/tickets/26')
  await waitFor(() => {
    expect(box()).toBeTruthy()
  })

  await user.type(box(), '    ')
  await user.click(send())

  expect(await screen.findByText('Write a reply')).toBeTruthy()
  expect(sent).toEqual([])
})

test('a reply the API refuses stays in the box, with the failure shown', async () => {
  const user = userEvent.setup()
  stubTicket(() => responds.error(400, 'Invalid request body'))

  renderRoute('/tickets/26')
  await waitFor(() => {
    expect(box()).toBeTruthy()
  })

  await user.type(box(), 'Worth keeping.')
  await user.click(send())

  expect((await screen.findByRole('alert')).textContent).toBe('Invalid request body')
  // Not thrown away: its author can try again rather than write it twice.
  expect((box() as HTMLTextAreaElement).value).toBe('Worth keeping.')
  expect(await screen.findAllByRole('article')).toHaveLength(1)
})
