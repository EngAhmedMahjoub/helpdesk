import { ADMIN } from '../config.ts'
import { uniqueSubject, userIdFor } from '../database.ts'
import { expect, test } from '../fixtures.ts'
import { message, minutesAgo, thread, ticketRow } from '../tickets-page.ts'

test('a subject on the list opens the ticket and its thread, oldest message first', async ({
  adminPage,
  createTestTicket,
}) => {
  // The seeded admin authors the reply: Message.agentId is Restrict, so only a
  // user nothing in the run deletes can be left holding one.
  const agentId = await userIdFor(ADMIN.email)
  const ticket = await createTestTicket({
    subject: `${uniqueSubject('detail')} refund for the March cohort`,
    studentName: 'Maya Chen',
    messages: [
      { author: 'student', body: 'I was charged twice for March.', createdAt: minutesAgo(30) },
      { author: 'ai', body: 'Thanks — a colleague will check.', createdAt: minutesAgo(20) },
      { author: 'agent', agentId, body: 'Refunded today.', createdAt: minutesAgo(10) },
    ],
  })

  await adminPage.goto('/tickets?pageSize=50')
  await ticketRow(adminPage, ticket.subject).getByRole('link', { name: ticket.subject }).click()

  await test.step('the ticket is at its own address, under its own subject', async () => {
    await expect(adminPage).toHaveURL(`/tickets/${String(ticket.id)}`)
    await expect(adminPage.getByRole('heading', { name: ticket.subject })).toBeVisible()
    await expect(adminPage.getByText(`Maya Chen · ${ticket.studentEmail}`)).toBeVisible()
    await expect(
      adminPage.getByRole('link', { name: ticket.studentEmail, exact: true }),
    ).toHaveAttribute('href', `mailto:${encodeURIComponent(ticket.studentEmail)}`)
  })

  await test.step('student, AI and agent messages are told apart by name', async () => {
    const messages = thread(adminPage)

    await expect(messages).toHaveCount(3)
    await expect(messages.nth(0)).toHaveAccessibleName('Student message from Maya Chen')
    await expect(messages.nth(1)).toHaveAccessibleName('AI message from AI assistant')
    await expect(messages.nth(2)).toHaveAccessibleName(`Agent message from ${ADMIN.name}`)

    await expect(message(adminPage, 'Student message from Maya Chen')).toContainText(
      'I was charged twice for March.',
    )
  })

  await test.step('All tickets goes back to the list', async () => {
    // An anchor wearing a button's clothes, so it can be opened in a new tab.
    await adminPage.getByRole('link', { name: 'All tickets' }).click()

    await expect(adminPage).toHaveURL('/tickets')
  })
})
