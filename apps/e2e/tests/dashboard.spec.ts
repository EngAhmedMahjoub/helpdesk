import type { Locator, Page } from '@playwright/test'
import { uniqueSubject } from '../database.ts'
import { expect, test } from '../fixtures.ts'
import { hasQuery, ticketRow } from '../tickets-page.ts'

/**
 * The number a dashboard `dt` labels, read from the `dd` after it. XPath for
 * the sibling because nothing ties the two together for a role query: the
 * `dd` has no accessible name of its own, and the chart that draws the same
 * numbers is aria-hidden.
 */
async function countFor(scope: Page | Locator, term: string): Promise<number> {
  const value = await scope
    .getByRole('term')
    .filter({ hasText: new RegExp(`^${term}$`) })
    .locator('xpath=following-sibling::dd[1]')
    .textContent()
  return Number(value?.replaceAll(',', '') ?? Number.NaN)
}

test('the counts include tickets the spec created', async ({ adminPage, createTestTicket }) => {
  const prefix = uniqueSubject('dashboard-counts')

  // Never Closed with Refund: ticket-list.spec.ts asserts an exact total on that pair.
  await Promise.all([
    createTestTicket({ subject: `${prefix} lab login`, category: 'technical', needsAgent: true }),
    createTestTicket({ subject: `${prefix} exam date`, category: 'general', status: 'resolved' }),
    createTestTicket({ subject: `${prefix} unread`, status: 'open' }),
  ])

  await adminPage.goto('/')
  await expect(adminPage.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()

  const byStatus = adminPage.getByRole('region', { name: 'By status' })
  const byCategory = adminPage.getByRole('region', { name: 'By category' })

  // At least, never exactly: every spec in the run shares helpdesk_e2e and may
  // be adding tickets while this one reads. The exact arithmetic is proven in
  // apps/api/test/dashboard.test.ts; this only proves the counts reach the page.
  // Polled, because the numbers are only in the DOM once the request lands.
  await expect.poll(() => countFor(adminPage, 'Needs an agent')).toBeGreaterThanOrEqual(1)
  await expect.poll(() => countFor(byStatus, 'Open')).toBeGreaterThanOrEqual(2)
  await expect.poll(() => countFor(byStatus, 'Resolved')).toBeGreaterThanOrEqual(1)
  await expect.poll(() => countFor(byCategory, 'Technical')).toBeGreaterThanOrEqual(1)
  await expect.poll(() => countFor(byCategory, 'General')).toBeGreaterThanOrEqual(1)
  await expect.poll(() => countFor(byCategory, 'Not yet classified')).toBeGreaterThanOrEqual(1)
})

test('View tickets needing an agent opens the list filtered to them', async ({
  adminPage,
  createTestTicket,
}) => {
  const flagged = await createTestTicket({
    subject: `${uniqueSubject('dashboard-needs-agent')} refund request`,
    needsAgent: true,
    escalationReason: 'refund_approval',
  })

  await adminPage.goto('/')
  await adminPage.getByRole('link', { name: 'View tickets needing an agent' }).click()

  await expect(adminPage).toHaveURL(hasQuery({ needsAgent: 'true' }))
  // On the first page of 20 at the default sort: the whole run flags only a
  // handful of tickets, so nothing can push this one off it.
  await expect(ticketRow(adminPage, flagged.subject)).toBeVisible()
})

test('a newly created ticket is in Recent tickets, and its subject opens it', async ({
  adminPage,
  createTestTicket,
}) => {
  // Dated an hour ahead so it outranks anything a parallel spec creates while
  // this one runs: they all take the default of now, and only five fit. It is
  // still found by its subject, never by its position.
  const ticket = await createTestTicket({
    subject: `${uniqueSubject('dashboard-recent')} transcript request`,
    createdAt: new Date(Date.now() + 60 * 60_000),
  })

  await adminPage.goto('/')
  const subjectLink = adminPage
    .getByRole('region', { name: 'Recent tickets' })
    .getByRole('link', { name: ticket.subject })

  await expect(subjectLink).toBeVisible()
  await subjectLink.click()

  await expect(adminPage).toHaveURL(`/tickets/${String(ticket.id)}`)
  await expect(adminPage.getByRole('heading', { name: ticket.subject })).toBeVisible()
})

test('View all tickets opens the list newest ticket first', async ({ adminPage }) => {
  await adminPage.goto('/')
  await adminPage
    .getByRole('region', { name: 'Recent tickets' })
    .getByRole('link', { name: 'View all tickets' })
    .click()

  await expect(adminPage).toHaveURL(hasQuery({ sort: 'createdAt', order: 'desc' }))
  await expect(adminPage.getByLabel('Sort by', { exact: true })).toHaveText('Newest ticket')
})
