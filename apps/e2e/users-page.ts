import type { Browser, BrowserContext, Locator, Page } from '@playwright/test'
import { API_URL } from './config.ts'
import { expect, sessionCookie, type Credentials } from './fixtures.ts'

export type SignedInElsewhere = { context: BrowserContext; page: Page; token: string }

/**
 * A browser context of the user's own, so nothing they do can ride on the
 * admin's cookie and nothing the admin does can reach them except through the
 * server. Close the context yourself; the session row goes with the user when
 * the fixture that made them deletes it.
 */
export async function signInElsewhere(
  browser: Browser,
  user: Credentials,
): Promise<SignedInElsewhere> {
  const context = await browser.newContext()
  const page = await context.newPage()

  const response = await page.request.post(`${API_URL}/api/auth/login`, { data: user })
  await expect(response).toBeOK()

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Helpdesk' })).toBeVisible()

  const { value: token } = await sessionCookie(page)
  return { context, page, token }
}

/** Matched by address: names are only unique per label, addresses per test. */
export function userRow(page: Page, email: string): Locator {
  return page.getByRole('row').filter({ hasText: email })
}

/** The page's status line, once it mentions this user. */
export function announcement(page: Page, name: string): Locator {
  // Filtered: the table skeleton is a status region too, while the list loads.
  return page.getByRole('status').filter({ hasText: name })
}

/** Clicks the row's pencil and returns the dialog it opened. */
export async function openEditDialog(
  page: Page,
  user: { email: string; name: string },
): Promise<Locator> {
  await userRow(page, user.email)
    .getByRole('button', { name: `Edit ${user.name}`, exact: true })
    .click()

  const dialog = page.getByRole('dialog', { name: `Edit ${user.name}`, exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}
