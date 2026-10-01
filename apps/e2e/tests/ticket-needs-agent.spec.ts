import { uniqueSubject } from '../database.ts'
import { expect, test } from '../fixtures.ts'
import { chooseOption, hasQuery, ownRows, ticketRow } from '../tickets-page.ts'

test('the Needs agent filter narrows the list to escalated tickets, each with its reason', async ({
  adminPage,
  createTestTicket,
}) => {
  const prefix = uniqueSubject('needs-agent')
  const [refund, failed, answered] = await Promise.all([
    createTestTicket({
      subject: `${prefix} double charge`,
      needsAgent: true,
      escalationReason: 'refund_approval',
    }),
    createTestTicket({
      subject: `${prefix} odd question`,
      needsAgent: true,
      escalationReason: 'ai_failed',
    }),
    createTestTicket({ subject: `${prefix} password reset` }),
  ])

  // Open alongside, so the filter is seen joining another rather than replacing it.
  const filters = { status: 'open', sort: 'updatedAt', order: 'desc', page: '1', pageSize: '50' }

  await adminPage.goto('/tickets?status=open&pageSize=50')
  await expect(ownRows(adminPage, prefix)).toHaveCount(3)

  await test.step('Needs agent leaves only the escalated tickets', async () => {
    await chooseOption(adminPage, 'Needs agent', 'Needs agent')

    await expect(adminPage).toHaveURL(hasQuery({ ...filters, needsAgent: 'true' }))
    await expect(ownRows(adminPage, prefix)).toHaveCount(2)
    await expect(ticketRow(adminPage, answered.subject)).toBeHidden()
  })

  await test.step('each says why it is waiting', async () => {
    await expect(
      ticketRow(adminPage, refund.subject).getByText('refund approval', { exact: true }),
    ).toBeVisible()
    await expect(
      ticketRow(adminPage, failed.subject).getByText('AI could not answer', { exact: true }),
    ).toBeVisible()
  })

  await test.step('All lifts the filter and keeps the others', async () => {
    await chooseOption(adminPage, 'Needs agent', 'All')

    await expect(adminPage).toHaveURL(hasQuery(filters))
    await expect(ownRows(adminPage, prefix)).toHaveCount(3)
    await expect(
      ticketRow(adminPage, answered.subject).getByText('No', { exact: true }),
    ).toBeVisible()
  })
})
