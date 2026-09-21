import { uniqueSubject } from '../database.ts'
import { expect, test } from '../fixtures.ts'
import { chooseOption, updateAnnouncement } from '../tickets-page.ts'

test('status, category and Needs agent changes are still there after a reload', async ({
  adminPage,
  createTestTicket,
}) => {
  const ticket = await createTestTicket({
    subject: `${uniqueSubject('controls')} double charge`,
    status: 'open',
    needsAgent: true,
    escalationReason: 'refund_approval',
  })
  const status = adminPage.getByLabel('Status', { exact: true })
  const category = adminPage.getByLabel('Category', { exact: true })
  const badge = adminPage.getByText('Needs agent: refund approval')
  const clear = adminPage.getByRole('button', { name: 'Clear' })

  await adminPage.goto(`/tickets/${String(ticket.id)}`)

  await test.step('the ticket arrives open, unclassified and escalated', async () => {
    await expect(status).toHaveText('open')
    // Its own word for having no category yet; the select is never left without
    // a value, or Radix would hold state of its own (#167).
    await expect(category).toHaveText('unclassified')
    await expect(badge).toBeVisible()
  })

  await test.step('the status changes to resolved', async () => {
    await chooseOption(adminPage, 'Status', 'resolved')

    // The select is controlled by the ticket the API answered with, so the new
    // word appearing is the PATCH having landed — nothing to sleep on.
    await expect(status).toHaveText('resolved')
    // Resolved is the only status with a timer, so the stamp appearing says the
    // change went through the transition helper rather than straight to the column.
    await expect(adminPage.getByText('Closes automatically:')).toBeVisible()
  })

  await test.step('the ticket is classified technical', async () => {
    await chooseOption(adminPage, 'Category', 'technical')

    await expect(category).toHaveText('technical')
  })

  await test.step('unclassified is not among the choices any more', async () => {
    await category.click()

    // The API takes no null back, so a ticket can be classified but never
    // un-classified: once it has a category, unclassified is not even listed.
    await expect(adminPage.getByRole('option')).toHaveText(['general', 'technical', 'refund'])

    await adminPage.keyboard.press('Escape')
    await expect(adminPage.getByRole('listbox')).toBeHidden()
  })

  await test.step('Needs agent is cleared', async () => {
    await clear.click()

    await expect(badge).toBeHidden()
    await expect(clear).toBeHidden()
  })

  await test.step('all three changes survive a reload', async () => {
    // Reloading before the PATCH lands would cancel it mid-flight, so wait for
    // the announcement, which is rendered from the API's answer.
    await expect(updateAnnouncement(adminPage)).toHaveText('Ticket updated: resolved, technical.')

    await adminPage.reload()

    await expect(status).toHaveText('resolved')
    await expect(category).toHaveText('technical')
    // Asserted after the selects, so "gone" cannot be a page that has not
    // finished loading.
    await expect(badge).toBeHidden()
  })
})
