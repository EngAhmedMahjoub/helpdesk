import type { Page } from '@playwright/test'
import { ADMIN } from '../config.ts'
import { countSessionsFor, findSessionByToken } from '../database.ts'
import { SESSION_COOKIE, expect, sessionCookie, test } from '../fixtures.ts'
import { submitLoginForm } from '../login-form.ts'

/**
 * The one message the API answers for an unknown address, a wrong password and
 * a deactivated account alike, so that a failed login never reveals which
 * addresses have accounts. The other two refusals are covered at the API layer;
 * this spec holds the one that proves the form shows it.
 */
const REFUSAL = 'Invalid email or password'

async function submitLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login')
  await submitLoginForm(page, { email, password })
}

test('the seeded admin signs in and reaches the dashboard', async ({ page }) => {
  await submitLogin(page, ADMIN.email, ADMIN.password)

  await expect(page).toHaveURL('/')

  await test.step('the dashboard shows the needs-agent count and both charts', async () => {
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()
    const needsAgent = page.getByRole('term').filter({ hasText: /^Needs an agent$/ })
    await expect(needsAgent).toBeVisible()
    await expect(needsAgent.locator('xpath=following-sibling::dd[1]')).toHaveText(/^[\d,]+$/)
    await expect(page.getByRole('region', { name: 'By status' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'By category' })).toBeVisible()
  })

  const cookie = await sessionCookie(page)

  await test.step('the cookie names a live session for the admin', async () => {
    const session = await findSessionByToken(cookie.value)

    expect(session?.user.email).toBe(ADMIN.email)
    expect(session?.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  await test.step('the session cookie is hidden from scripts on the page', async () => {
    expect(cookie.httpOnly).toBe(true)

    // The flag is only worth anything if the page really cannot read the value:
    // an XSS on this origin must not be able to walk off with a live session.
    const visibleToScripts = await page.evaluate(() => document.cookie)
    expect(visibleToScripts).not.toContain(SESSION_COOKIE)
    expect(visibleToScripts).not.toContain(cookie.value)
  })

  await test.step('going back does not return to the login form', async () => {
    // Signing in navigates with replace, so the login entry is gone from the
    // history and back leaves the app entirely — here to the blank page the tab
    // started on. A signed-in visitor pressing back never meets a form asking
    // again for credentials they have already given.
    await page.goBack()

    await expect(page).not.toHaveURL('/login')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeHidden()
  })
})

test('a wrong password is refused and creates no session', async ({ page, createTestUser }) => {
  const user = await createTestUser({ label: 'wrong-password' })

  await submitLogin(page, user.email, 'not-this-users-password')

  await expect(page.getByRole('alert')).toHaveText(REFUSAL)
  await expect(page).toHaveURL('/login')
  expect(await countSessionsFor(user.id)).toBe(0)
})
