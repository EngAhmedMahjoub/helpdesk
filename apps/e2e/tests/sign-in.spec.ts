import type { Page } from '@playwright/test'
import { ADMIN } from '../config.ts'
import { countSessionsFor, findSessionByToken } from '../database.ts'
import { expect, sessionCookie, test } from '../fixtures.ts'
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
  await expect(page.getByRole('heading', { name: 'Helpdesk' })).toBeVisible()

  const cookie = await sessionCookie(page)
  const session = await findSessionByToken(cookie.value)

  expect(session?.user.email).toBe(ADMIN.email)
  expect(session?.expiresAt.getTime()).toBeGreaterThan(Date.now())
})

test('a wrong password is refused and creates no session', async ({ page, createTestUser }) => {
  const user = await createTestUser({ label: 'wrong-password' })

  await submitLogin(page, user.email, 'not-this-users-password')

  await expect(page.getByRole('alert')).toHaveText(REFUSAL)
  await expect(page).toHaveURL('/login')
  expect(await countSessionsFor(user.id)).toBe(0)
})

test('going back after signing in does not return to the login form', async ({ page }) => {
  await submitLogin(page, ADMIN.email, ADMIN.password)
  await expect(page).toHaveURL('/')

  // Signing in navigates with replace, so the login entry is gone from the
  // history and back leaves the app entirely — here to the blank page the tab
  // started on. A signed-in visitor pressing back never meets a form asking
  // again for credentials they have already given.
  await page.goBack()

  await expect(page).not.toHaveURL('/login')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeHidden()
})
