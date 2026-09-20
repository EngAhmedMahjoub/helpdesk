import type { Locator, Page } from '@playwright/test'

/**
 * A row of the ticket list, by any text only it carries. The list has no search
 * box, so a spec finds its own tickets by the subject stem it gave them; every
 * other spec's tickets are on the same page.
 */
export function ticketRow(page: Page, subject: string): Locator {
  return page.getByRole('row').filter({ hasText: subject })
}

/**
 * Every row this spec owns, in the order the list shows them. Assert on these
 * rather than on the table: what else is in it belongs to other specs, and a
 * count or a position that includes them says nothing.
 */
export function ownRows(page: Page, subjectPrefix: string): Locator {
  return page.getByRole('row').filter({ hasText: subjectPrefix })
}

/**
 * Picks a value in one of the Radix selects.
 *
 * They are comboboxes built from buttons and a floating listbox, not a native
 * `<select>`, so `selectOption` does not reach them: the trigger has to be
 * opened before the option exists in the DOM at all.
 */
export async function chooseOption(page: Page, label: string, option: string): Promise<void> {
  await page.getByLabel(label, { exact: true }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

/** One message in the thread, by the author line its accessible name carries. */
export function message(page: Page, name: string): Locator {
  return page.getByRole('article', { name, exact: true })
}

/** The thread's messages, oldest first, for asserting on their order. */
export function thread(page: Page): Locator {
  return page.getByRole('article')
}

/**
 * Matches a ticket-list URL whose query is exactly these parameters.
 *
 * Exact rather than a subset: the rule that any change but paging returns to
 * page 1 is only visible in what the query no longer says. Written as a
 * predicate because the page builds the query in its own key order, which is
 * not something a spec should be pinned to.
 */
export function hasQuery(expected: Record<string, string>): (url: URL) => boolean {
  return (url) => {
    const actual = Object.fromEntries(url.searchParams)
    const keys = new Set([...Object.keys(actual), ...Object.keys(expected)])
    return url.pathname === '/tickets' && [...keys].every((key) => actual[key] === expected[key])
  }
}

/**
 * The ticket detail's live region, once a change has been saved.
 *
 * The one signal on that page that the API answered. The Category select is
 * given no value at all while a ticket is unclassified, which leaves Radix
 * holding its own state: the trigger shows the word an agent picked whether or
 * not the PATCH ever landed, so waiting on the trigger waits for nothing.
 */
export function updateAnnouncement(page: Page): Locator {
  return page.getByRole('status').filter({ hasText: 'Ticket updated' })
}
