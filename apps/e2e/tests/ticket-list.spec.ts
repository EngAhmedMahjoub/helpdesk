import { uniqueSubject } from '../database.ts'
import { expect, test } from '../fixtures.ts'
import { chooseOption, hasQuery, ownRows, ticketRow } from '../tickets-page.ts'

/**
 * Every spec in a run shares `helpdesk_e2e`, and the list has no search box, so
 * a spec's own tickets are only as findable as the page is long. 50 is the
 * largest size the Rows per page control offers and comfortably more than the
 * whole ticket suite creates, which keeps every row this spec made on one page
 * whatever else is running beside it.
 */
const ALL_ON_ONE_PAGE = 'pageSize=50'

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000)

test('the list shows who a ticket is from, its status, category and escalation', async ({
  adminPage,
  createTestTicket,
}) => {
  const prefix = uniqueSubject('list-cells')

  const named = await createTestTicket({
    subject: `${prefix} named student`,
    studentName: 'Maya Chen',
    status: 'open',
    category: 'general',
  })
  const nameless = await createTestTicket({
    subject: `${prefix} nameless student`,
    status: 'resolved',
    needsAgent: true,
    escalationReason: 'refund_approval',
  })

  await adminPage.goto(`/tickets?${ALL_ON_ONE_PAGE}`)

  await test.step('a ticket from a student the email named', async () => {
    const row = ticketRow(adminPage, named.subject)

    await expect(row.getByRole('link', { name: named.subject, exact: true })).toBeVisible()
    await expect(row.getByRole('cell', { name: 'Maya Chen', exact: true })).toBeVisible()
    await expect(row.getByRole('cell', { name: 'open', exact: true })).toBeVisible()
    await expect(row.getByRole('cell', { name: 'general', exact: true })).toBeVisible()
    await expect(row.getByRole('cell', { name: 'No', exact: true })).toBeVisible()
  })

  await test.step('a ticket whose From header carried no display name', async () => {
    const row = ticketRow(adminPage, nameless.subject)

    // The address stands in for the name, because there is nothing else to show.
    await expect(row.getByRole('cell', { name: nameless.studentEmail, exact: true })).toBeVisible()
    await expect(row.getByRole('cell', { name: 'resolved', exact: true })).toBeVisible()
    // An em dash rather than an empty cell: nothing has classified it yet.
    await expect(row.getByRole('cell', { name: '—', exact: true })).toBeVisible()
    await expect(row.getByRole('cell', { name: 'Yes', exact: true })).toBeVisible()
  })
})

test('an agent sees tickets too', async ({ page, signIn, createTestUser, createTestTicket }) => {
  const agent = await createTestUser({ label: 'ticket-reader', role: 'agent' })
  const ticket = await createTestTicket({ subject: `${uniqueSubject('agent-view')} question` })
  await signIn(agent)

  await page.goto(`/tickets?${ALL_ON_ONE_PAGE}`)

  await expect(ticketRow(page, ticket.subject)).toBeVisible()
})

test('the Status and Category filters narrow the list and live in the URL', async ({
  adminPage,
  createTestTicket,
}) => {
  const prefix = uniqueSubject('list-filter')

  const openGeneral = await createTestTicket({
    subject: `${prefix} open general`,
    status: 'open',
    category: 'general',
  })
  const openTechnical = await createTestTicket({
    subject: `${prefix} open technical`,
    status: 'open',
    category: 'technical',
  })
  const resolvedTechnical = await createTestTicket({
    subject: `${prefix} resolved technical`,
    status: 'resolved',
    category: 'technical',
  })

  await adminPage.goto(`/tickets?${ALL_ON_ONE_PAGE}`)
  await expect(ownRows(adminPage, prefix)).toHaveCount(3)

  await test.step('Status open leaves the resolved ticket out', async () => {
    await chooseOption(adminPage, 'Status', 'open')

    await expect(adminPage).toHaveURL(
      hasQuery({ status: 'open', sort: 'updatedAt', order: 'desc', page: '1', pageSize: '50' }),
    )
    await expect(ownRows(adminPage, prefix)).toHaveCount(2)
    await expect(ticketRow(adminPage, resolvedTechnical.subject)).toHaveCount(0)
  })

  await test.step('Category technical narrows it to the one ticket that is both', async () => {
    await chooseOption(adminPage, 'Category', 'technical')

    await expect(adminPage).toHaveURL(
      hasQuery({
        status: 'open',
        category: 'technical',
        sort: 'updatedAt',
        order: 'desc',
        page: '1',
        pageSize: '50',
      }),
    )
    await expect(ownRows(adminPage, prefix)).toHaveCount(1)
    await expect(ticketRow(adminPage, openTechnical.subject)).toBeVisible()
    await expect(ticketRow(adminPage, openGeneral.subject)).toHaveCount(0)
  })

  await test.step('Status All drops the parameter and brings the resolved one back', async () => {
    await chooseOption(adminPage, 'Status', 'All')

    await expect(adminPage).toHaveURL(
      hasQuery({
        category: 'technical',
        sort: 'updatedAt',
        order: 'desc',
        page: '1',
        pageSize: '50',
      }),
    )
    await expect(ownRows(adminPage, prefix)).toHaveCount(2)
    await expect(ticketRow(adminPage, resolvedTechnical.subject)).toBeVisible()
  })
})

test('Sort by orders the list on activity or on when the ticket arrived', async ({
  adminPage,
  createTestTicket,
}) => {
  const prefix = uniqueSubject('list-sort')

  // Created and last active in deliberately different orders, so a sort on the
  // wrong column cannot pass by accident.
  const alpha = await createTestTicket({
    subject: `${prefix} alpha`,
    createdAt: minutesAgo(180),
    updatedAt: minutesAgo(60),
  })
  const beta = await createTestTicket({
    subject: `${prefix} beta`,
    createdAt: minutesAgo(120),
    updatedAt: minutesAgo(180),
  })
  const gamma = await createTestTicket({
    subject: `${prefix} gamma`,
    createdAt: minutesAgo(60),
    updatedAt: minutesAgo(120),
  })

  // Only this spec's rows, in the order the list put them. Other specs' tickets
  // sit between them, and where they land is none of this spec's business.
  const rows = ownRows(adminPage, prefix)
  const order = (...subjects: string[]) => subjects.map((subject) => new RegExp(subject))

  await adminPage.goto(`/tickets?${ALL_ON_ONE_PAGE}`)

  await test.step('latest activity first, without being asked', async () => {
    await expect(rows).toHaveText(order(alpha.subject, gamma.subject, beta.subject))
  })

  await test.step('oldest activity first', async () => {
    await chooseOption(adminPage, 'Sort by', 'Oldest activity')

    await expect(adminPage).toHaveURL(
      hasQuery({ sort: 'updatedAt', order: 'asc', page: '1', pageSize: '50' }),
    )
    await expect(rows).toHaveText(order(beta.subject, gamma.subject, alpha.subject))
  })

  await test.step('newest ticket first', async () => {
    await chooseOption(adminPage, 'Sort by', 'Newest ticket')

    await expect(adminPage).toHaveURL(
      hasQuery({ sort: 'createdAt', order: 'desc', page: '1', pageSize: '50' }),
    )
    await expect(rows).toHaveText(order(gamma.subject, beta.subject, alpha.subject))
  })

  await test.step('oldest ticket first', async () => {
    await chooseOption(adminPage, 'Sort by', 'Oldest ticket')

    await expect(adminPage).toHaveURL(
      hasQuery({ sort: 'createdAt', order: 'asc', page: '1', pageSize: '50' }),
    )
    await expect(rows).toHaveText(order(alpha.subject, beta.subject, gamma.subject))
  })
})

/**
 * The one spec that may assert on a total, because it filters to a pair no
 * other spec uses: Closed *and* Refund. Keep it that way — a closed refund
 * ticket created anywhere else in the suite lands on this page and fails it.
 */
test('paging walks through the tickets without losing the filters', async ({
  adminPage,
  createTestTicket,
}) => {
  const prefix = uniqueSubject('list-paging')
  const count = 8

  // Timestamps a minute apart, so "oldest ticket first" is one fixed order
  // rather than eight rows sharing a stamp and tie-breaking on id.
  const tickets = await Promise.all(
    Array.from({ length: count }, (_, index) =>
      createTestTicket({
        subject: `${prefix} ${String(index + 1).padStart(2, '0')}`,
        status: 'closed',
        category: 'refund',
        createdAt: minutesAgo(count - index),
      }),
    ),
  )

  const subjects = tickets.map((ticket) => new RegExp(ticket.subject))
  const filters = { status: 'closed', category: 'refund', sort: 'createdAt', order: 'asc' }
  const pagination = adminPage.getByRole('navigation', { name: 'Pagination' })
  const summary = pagination.getByText(/^Showing /)

  await adminPage.goto('/tickets?status=closed&category=refund&sort=createdAt&order=asc&pageSize=5')

  await test.step('the first five, oldest first', async () => {
    await expect(summary).toHaveText(`Showing 1–5 of ${String(count)}`)
    await expect(ownRows(adminPage, prefix)).toHaveText(subjects.slice(0, 5))
    await expect(pagination.getByRole('button', { name: 'Previous' })).toBeDisabled()
  })

  await test.step('Next carries the filters to the remaining three', async () => {
    await pagination.getByRole('button', { name: 'Next' }).click()

    await expect(adminPage).toHaveURL(hasQuery({ ...filters, page: '2', pageSize: '5' }))
    await expect(summary).toHaveText(`Showing 6–${String(count)} of ${String(count)}`)
    await expect(ownRows(adminPage, prefix)).toHaveText(subjects.slice(5))
    await expect(pagination.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  await test.step('changing the sort goes back to page 1', async () => {
    await chooseOption(adminPage, 'Sort by', 'Newest ticket')

    // Page 2 of the old order is rarely page 2 of the new one, and an empty
    // page reads as no tickets at all.
    await expect(adminPage).toHaveURL(
      hasQuery({ ...filters, sort: 'createdAt', order: 'desc', page: '1', pageSize: '5' }),
    )
    await expect(summary).toHaveText(`Showing 1–5 of ${String(count)}`)
  })

  await test.step('ten rows a page fits them all', async () => {
    await chooseOption(adminPage, 'Rows per page', '10')

    await expect(adminPage).toHaveURL(
      hasQuery({ ...filters, sort: 'createdAt', order: 'desc', page: '1', pageSize: '10' }),
    )
    await expect(summary).toHaveText(`Showing 1–${String(count)} of ${String(count)}`)
    await expect(ownRows(adminPage, prefix)).toHaveCount(count)
  })
})
