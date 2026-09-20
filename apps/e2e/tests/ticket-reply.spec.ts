import { ADMIN } from '../config.ts'
import { countMessagesFor, uniqueSubject } from '../database.ts'
import { expect, test } from '../fixtures.ts'
import { thread } from '../tickets-page.ts'

/** Long enough that the assertion cannot match anything else on the page. */
const REPLY = 'Refunded the duplicate charge; it should land in three days.'

test('a reply joins the end of the thread and outlives a reload', async ({
  adminPage,
  createTestTicket,
}) => {
  const ticket = await createTestTicket({
    subject: `${uniqueSubject('reply')} charged twice`,
    studentName: 'Maya Chen',
    messages: [{ author: 'student', body: 'I paid for March twice.' }],
  })
  const box = adminPage.getByLabel('Reply to Maya Chen')

  await adminPage.goto(`/tickets/${String(ticket.id)}`)
  await box.fill(REPLY)
  await adminPage.getByRole('button', { name: 'Send reply' }).click()

  await test.step('it is attributed to whoever is signed in', async () => {
    const messages = thread(adminPage)

    await expect(messages).toHaveCount(2)
    await expect(messages.nth(1)).toHaveAccessibleName(`Agent message from ${ADMIN.name}`)
    await expect(messages.nth(1)).toContainText(REPLY)
  })

  await test.step('the box is empty again, ready for the next one', async () => {
    await expect(box).toHaveValue('')
  })

  await test.step('it was stored, not only shown', async () => {
    await adminPage.reload()

    await expect(thread(adminPage).nth(1)).toContainText(REPLY)
    // Scoped to this spec's own ticket; the table itself is shared.
    expect(await countMessagesFor(ticket.id)).toBe(2)
  })
})

test('an empty reply is refused before anything is sent', async ({
  adminPage,
  createTestTicket,
}) => {
  const ticket = await createTestTicket({
    subject: `${uniqueSubject('reply-empty')} quick question`,
    studentName: 'Maya Chen',
    messages: [{ author: 'student', body: 'Is the deadline Friday?' }],
  })

  await adminPage.goto(`/tickets/${String(ticket.id)}`)
  await expect(thread(adminPage)).toHaveCount(1)

  await adminPage.getByRole('button', { name: 'Send reply' }).click()

  await expect(adminPage.getByRole('alert')).toHaveText('Write a reply')
  await expect(thread(adminPage)).toHaveCount(1)
  expect(await countMessagesFor(ticket.id)).toBe(1)
})
