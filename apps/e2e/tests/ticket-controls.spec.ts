import { uniqueSubject } from '../database.ts'
import { expect, test } from '../fixtures.ts'
import { chooseOption, updateAnnouncement } from '../tickets-page.ts'

test('the status an agent picks is still there after a reload', async ({
  adminPage,
  createTestTicket,
}) => {
  const ticket = await createTestTicket({
    subject: `${uniqueSubject('controls-status')} login trouble`,
    status: 'open',
    category: 'general',
  })
  const status = adminPage.getByLabel('Status', { exact: true })

  await adminPage.goto(`/tickets/${String(ticket.id)}`)
  await expect(status).toHaveText('open')

  await chooseOption(adminPage, 'Status', 'resolved')

  // The select is controlled by the ticket the API answered with, so the new
  // word appearing is the PATCH having landed — nothing to sleep on.
  await expect(status).toHaveText('resolved')
  // Resolved is the only status with a timer, so the stamp appearing says the
  // change went through the transition helper rather than straight to the column.
  await expect(adminPage.getByText('Closes automatically:')).toBeVisible()

  await adminPage.reload()

  await expect(status).toHaveText('resolved')
})

test('an unclassified ticket can be classified, and not put back', async ({
  adminPage,
  createTestTicket,
}) => {
  const ticket = await createTestTicket({
    subject: `${uniqueSubject('controls-category')} where are my slides`,
  })
  const category = adminPage.getByLabel('Category', { exact: true })

  await adminPage.goto(`/tickets/${String(ticket.id)}`)

  // A placeholder, not a value: nothing has classified it yet.
  await expect(category).toHaveText('unclassified')

  await chooseOption(adminPage, 'Category', 'technical')
  await expect(category).toHaveText('technical')
  // The announcement, not the trigger, is what says the change was saved, and
  // reloading before it lands cancels the request mid-flight.
  await expect(updateAnnouncement(adminPage)).toHaveText('Ticket updated: open, technical.')

  await adminPage.reload()
  await expect(category).toHaveText('technical')

  await test.step('unclassified is not among the choices', async () => {
    await category.click()

    // The API takes no null back, so a ticket can be classified but never
    // un-classified; the placeholder must not have become an option.
    await expect(adminPage.getByRole('option')).toHaveText(['general', 'technical', 'refund'])

    await adminPage.keyboard.press('Escape')
  })
})

test('clearing Needs agent takes the badge off the ticket for good', async ({
  adminPage,
  createTestTicket,
}) => {
  const ticket = await createTestTicket({
    subject: `${uniqueSubject('controls-escalation')} double charge`,
    needsAgent: true,
    escalationReason: 'refund_approval',
  })
  const badge = adminPage.getByText('Needs agent: refund approval')
  const clear = adminPage.getByRole('button', { name: 'Clear' })

  await adminPage.goto(`/tickets/${String(ticket.id)}`)
  await expect(badge).toBeVisible()

  await clear.click()

  await expect(badge).toBeHidden()
  await expect(clear).toBeHidden()

  await adminPage.reload()

  await expect(badge).toBeHidden()
  // Asserted after something that is on the page, so "gone" cannot be a page
  // that has not finished loading.
  await expect(adminPage.getByRole('heading', { name: ticket.subject })).toBeVisible()
})
