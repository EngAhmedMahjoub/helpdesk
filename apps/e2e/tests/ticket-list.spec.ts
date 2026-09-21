import { uniqueSubject } from '../database.ts'
import { expect, test } from '../fixtures.ts'
import { chooseOption, hasQuery, minutesAgo, ownRows } from '../tickets-page.ts'

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
