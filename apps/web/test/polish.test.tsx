import { expect, test } from 'bun:test'
import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { POLISH_MAX_LENGTH, type PolishRequest } from '@helpdesk/shared'
import { renderRoute, responds, stubApi, ticketDetail, ticketMessage } from './helpers.tsx'

const ticket = ticketDetail({
  id: 26,
  subject: "Can't log in",
  studentName: 'Maya Chen',
  messages: [ticketMessage({ id: 1, body: 'My details are wrong' })],
  pendingDraft: {
    id: 7,
    body: 'we have reset you password',
    createdAt: '2026-09-30T09:00:00.000Z',
    updatedAt: '2026-09-30T09:00:00.000Z',
  },
})

/**
 * Answers the ticket, and polishes the way the API would unless `onPolish`
 * answers instead. Records what was sent to be polished and what was emailed.
 */
function stubPolish(onPolish?: (sent: PolishRequest) => Response | Promise<Response>) {
  const polished: PolishRequest[] = []
  const requests = stubApi({
    '/auth/me': responds.currentUser,
    '/tickets/26': () => Response.json(ticket),
    '/ai/polish': async (request) => {
      const sent = (await request.clone().json()) as PolishRequest
      polished.push(sent)
      return onPolish ? onPolish(sent) : Response.json({ text: `Polished: ${sent.text}` })
    },
  })
  const sends = () => requests.filter((r) => /replies|approve/.test(r.url))
  return { polished, sends }
}

const replyBox = () => screen.getByLabelText('Reply to Maya Chen') as HTMLTextAreaElement
const draftBox = () => screen.getByLabelText('Draft reply to Maya Chen') as HTMLTextAreaElement
const replyForm = () => replyBox().closest('form')!
const draftForm = () => draftBox().closest('form')!
const polishIn = (form: HTMLElement) => within(form).getByRole('button', { name: /Polish/ })

async function open() {
  renderRoute('/tickets/26')
  await waitFor(() => {
    expect(replyBox()).toBeTruthy()
  })
}

test('Polish replaces the reply with the polished text, and sends nothing', async () => {
  const user = userEvent.setup()
  const { polished, sends } = stubPolish()
  await open()

  await user.type(replyBox(), 'thx for wating')
  await user.click(polishIn(replyForm()))

  await waitFor(() => {
    expect(replyBox().value).toBe('Polished: thx for wating')
  })
  expect(polished).toEqual([{ text: 'thx for wating' }])
  expect(sends()).toHaveLength(0)
})

test('Undo puts back what the agent wrote', async () => {
  const user = userEvent.setup()
  stubPolish()
  await open()

  await user.type(replyBox(), 'thx for wating')
  await user.click(polishIn(replyForm()))
  await user.click(await within(replyForm()).findByRole('button', { name: 'Undo polish' }))

  expect(replyBox().value).toBe('thx for wating')
  expect(within(replyForm()).queryByRole('button', { name: 'Undo polish' })).toBeNull()
})

test('Undo goes once the agent edits the polished text', async () => {
  const user = userEvent.setup()
  stubPolish()
  await open()

  await user.type(replyBox(), 'thx')
  await user.click(polishIn(replyForm()))
  await within(replyForm()).findByRole('button', { name: 'Undo polish' })

  await user.type(replyBox(), '!')

  expect(within(replyForm()).queryByRole('button', { name: 'Undo polish' })).toBeNull()
  expect(replyBox().value).toBe('Polished: thx!')
})

test('Polish is disabled while the box is empty', async () => {
  const user = userEvent.setup()
  stubPolish()
  await open()

  expect((polishIn(replyForm()) as HTMLButtonElement).disabled).toBe(true)

  await user.type(replyBox(), '   ')
  expect((polishIn(replyForm()) as HTMLButtonElement).disabled).toBe(true)

  await user.type(replyBox(), 'hi')
  expect((polishIn(replyForm()) as HTMLButtonElement).disabled).toBe(false)
})

test('Polish and Send are disabled while a polish is running', async () => {
  const user = userEvent.setup()
  let finish: () => void = () => undefined
  stubPolish(
    (sent) =>
      new Promise((resolve) => {
        finish = () => {
          resolve(Response.json({ text: `Polished: ${sent.text}` }))
        }
      }),
  )
  await open()

  await user.type(replyBox(), 'hello')
  await user.click(polishIn(replyForm()))

  const running = await within(replyForm()).findByRole('button', { name: /Polishing/ })
  expect((running as HTMLButtonElement).disabled).toBe(true)
  expect(
    (within(replyForm()).getByRole('button', { name: 'Send reply' }) as HTMLButtonElement).disabled,
  ).toBe(true)
  expect(replyBox().readOnly).toBe(true)

  finish()
  await waitFor(() => {
    expect(replyBox().value).toBe('Polished: hello')
  })
  expect((polishIn(replyForm()) as HTMLButtonElement).disabled).toBe(false)
})

test('a failed polish shows why and leaves the text as it was', async () => {
  const user = userEvent.setup()
  stubPolish(() =>
    Response.json(
      { error: 'Claude could not polish this text. Your text is unchanged.' },
      { status: 502 },
    ),
  )
  await open()

  await user.type(replyBox(), 'hello')
  await user.click(polishIn(replyForm()))

  expect((await within(replyForm()).findByRole('alert')).textContent).toBe(
    'Claude could not polish this text. Your text is unchanged.',
  )
  expect(replyBox().value).toBe('hello')
})

test('text over the limit is refused here, without asking the API', async () => {
  const user = userEvent.setup()
  const { polished } = stubPolish()
  await open()

  // Pasted, not typed: typing 5,000 characters one at a time takes seconds.
  await user.click(replyBox())
  await user.paste('a'.repeat(POLISH_MAX_LENGTH + 1))
  await user.click(polishIn(replyForm()))

  expect((await within(replyForm()).findByRole('alert')).textContent).toBe(
    `Polish at most ${String(POLISH_MAX_LENGTH)} characters at a time`,
  )
  expect(polished).toHaveLength(0)
})

test("Polish works on the AI's draft too, and Undo restores the draft", async () => {
  const user = userEvent.setup()
  const { polished, sends } = stubPolish()
  await open()

  await user.click(polishIn(draftForm()))

  await waitFor(() => {
    expect(draftBox().value).toBe('Polished: we have reset you password')
  })
  expect(polished).toEqual([{ text: 'we have reset you password' }])
  expect(sends()).toHaveLength(0)

  await user.click(within(draftForm()).getByRole('button', { name: 'Undo polish' }))
  expect(draftBox().value).toBe('we have reset you password')
})
