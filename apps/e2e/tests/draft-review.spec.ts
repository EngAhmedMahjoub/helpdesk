import type { Locator, Page } from '@playwright/test'
import { ADMIN } from '../config.ts'
import {
  createDraft,
  findDraft,
  rewriteDraft,
  uniqueSubject,
  userIdFor,
  type NewTicket,
} from '../database.ts'
import { expect, test } from '../fixtures.ts'
import { thread } from '../tickets-page.ts'

const STUDENT = 'Maya Chen'
const AI_DRAFT = 'Thanks for writing in. Your refund has been approved and is on its way.'
/** Long enough that the assertion cannot match anything else on the page. */
const EDITED = 'Approved: the duplicate March charge is refunded and lands within three days.'
const REWRITTEN = 'Thanks for the receipt. The refund is approved for both March charges.'

/**
 * The panel as a whole. Its heading also carries the AI badge, so its name is
 * matched as a substring rather than exactly.
 */
function panel(page: Page): Locator {
  return page.getByRole('region', { name: /Draft reply awaiting review/ })
}

function draftBox(page: Page): Locator {
  return page.getByLabel(`Draft reply to ${STUDENT}`)
}

/** Escalated for a refund, as the AI leaves a ticket whose reply needs an agent's yes. */
function escalatedTicket(subject: string): NewTicket {
  return {
    subject,
    studentName: STUDENT,
    needsAgent: true,
    escalationReason: 'refund_approval',
    senderVerified: true,
    messages: [{ author: 'student', body: 'I was charged twice for March.' }],
  }
}

test('an agent approves an edited draft and it is sent as their reply', async ({
  adminPage,
  createTestTicket,
}) => {
  const ticket = await createTestTicket(escalatedTicket(`${uniqueSubject('draft-approve')} refund`))
  const draft = await createDraft(ticket.id, AI_DRAFT)
  const status = adminPage.getByLabel('Status', { exact: true })
  const escalation = adminPage.getByText('Needs agent: refund approval')

  await adminPage.goto(`/tickets/${String(ticket.id)}`)

  await test.step('the AI draft waits for review, the ticket open and escalated', async () => {
    await expect(panel(adminPage)).toBeVisible()
    await expect(draftBox(adminPage)).toHaveValue(AI_DRAFT)
    await expect(status).toHaveText('open')
    await expect(escalation).toBeVisible()
    // The warning's absence here is what gives its presence below a meaning.
    await expect(adminPage.getByText(/may be forged/)).toBeHidden()
  })

  await test.step('the agent edits it and approves', async () => {
    await draftBox(adminPage).fill(EDITED)
    await adminPage.getByRole('button', { name: 'Approve and send' }).click()

    // The announcement lives outside the panel, so it outlasts it.
    await expect(
      adminPage.getByRole('status').filter({ hasText: `Reply sent to ${STUDENT}.` }),
    ).toBeAttached()
    await expect(panel(adminPage)).toBeHidden()
  })

  await test.step('the edit joins the thread as the agent’s own message', async () => {
    const messages = thread(adminPage)

    await expect(messages).toHaveCount(2)
    // Agent, not AI: approving made it the approver's reply.
    await expect(messages.nth(1)).toHaveAccessibleName(`Agent message from ${ADMIN.name}`)
    await expect(messages.nth(1)).toContainText(EDITED)
  })

  await test.step('the ticket is resolved and no longer needs an agent', async () => {
    await expect(status).toHaveText('resolved')
    await expect(escalation).toBeHidden()
    await expect(adminPage.getByRole('button', { name: 'Clear' })).toBeHidden()
  })

  await test.step('all of it survives a reload', async () => {
    await adminPage.reload()

    await expect(status).toHaveText('resolved')
    await expect(thread(adminPage)).toHaveCount(2)
    await expect(thread(adminPage).nth(1)).toContainText(EDITED)
    // Asserted after the thread, so "gone" cannot be a page still loading.
    await expect(panel(adminPage)).toBeHidden()
    await expect(escalation).toBeHidden()

    expect(await findDraft(draft.id)).toEqual({
      status: 'approved',
      body: EDITED,
      reviewedById: await userIdFor(ADMIN.email),
    })
  })
})

test('a rejected draft sends nothing and leaves the ticket waiting for an agent', async ({
  adminPage,
  createTestTicket,
}) => {
  const ticket = await createTestTicket(escalatedTicket(`${uniqueSubject('draft-reject')} refund`))
  const draft = await createDraft(ticket.id, AI_DRAFT)
  const status = adminPage.getByLabel('Status', { exact: true })
  const escalation = adminPage.getByText('Needs agent: refund approval')

  await adminPage.goto(`/tickets/${String(ticket.id)}`)
  await expect(draftBox(adminPage)).toHaveValue(AI_DRAFT)

  await test.step('Reject takes the panel away', async () => {
    await adminPage.getByRole('button', { name: 'Reject' }).click()

    await expect(
      adminPage.getByRole('status').filter({ hasText: 'Draft rejected.' }),
    ).toBeAttached()
    await expect(panel(adminPage)).toBeHidden()
  })

  await test.step('nothing joins the thread and the ticket stays open and escalated', async () => {
    await expect(thread(adminPage)).toHaveCount(1)
    // The student has still not been answered, so it stays in front of agents.
    await expect(status).toHaveText('open')
    await expect(escalation).toBeVisible()
  })

  await test.step('and so it stays after a reload', async () => {
    await adminPage.reload()

    await expect(status).toHaveText('open')
    await expect(escalation).toBeVisible()
    await expect(thread(adminPage)).toHaveCount(1)
    await expect(panel(adminPage)).toBeHidden()

    expect((await findDraft(draft.id)).status).toBe('rejected')
  })
})

test('a draft the AI rewrote while it was open is shown anew instead of sent', async ({
  adminPage,
  createTestTicket,
}) => {
  const ticket = await createTestTicket(escalatedTicket(`${uniqueSubject('draft-stale')} refund`))
  const draft = await createDraft(ticket.id, AI_DRAFT)

  await adminPage.goto(`/tickets/${String(ticket.id)}`)
  await expect(draftBox(adminPage)).toHaveValue(AI_DRAFT)

  // As the pipeline does on a student's follow-up, behind the open page's back.
  await rewriteDraft(draft.id, REWRITTEN)

  await test.step('approving the old version is refused', async () => {
    await adminPage.getByRole('button', { name: 'Approve and send' }).click()

    await expect(panel(adminPage).getByRole('alert')).toHaveText(
      'The AI updated this draft after a new message from the student. Review the new version.',
    )
  })

  await test.step('the box now holds the new version, still awaiting review', async () => {
    await expect(draftBox(adminPage)).toHaveValue(REWRITTEN)
    await expect(thread(adminPage)).toHaveCount(1)

    expect(await findDraft(draft.id)).toEqual({
      status: 'pending',
      body: REWRITTEN,
      reviewedById: null,
    })
  })
})

test('a draft for an unverified sender carries a forgery warning', async ({
  adminPage,
  createTestTicket,
}) => {
  const ticket = await createTestTicket({
    ...escalatedTicket(`${uniqueSubject('draft-unverified')} refund`),
    senderVerified: false,
  })
  await createDraft(ticket.id, AI_DRAFT)

  await adminPage.goto(`/tickets/${String(ticket.id)}`)

  // Inside the panel, before the buttons: approving would email whoever owns
  // the address, which may not be the student.
  await expect(
    panel(adminPage).getByText("This sender's address was not verified, so it may be forged"),
  ).toBeVisible()
})
