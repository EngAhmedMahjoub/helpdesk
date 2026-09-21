import { deleteSessionByToken } from '../database.ts'
import { SESSION_COOKIE, expect, sessionCookie, test } from '../fixtures.ts'

test('a logged-out visitor is sent to the login form', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveURL('/login')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
})

test('the session cookie is hidden from scripts on the page', async ({ adminPage }) => {
  await adminPage.goto('/')
  await expect(adminPage.getByRole('heading', { name: 'Helpdesk' })).toBeVisible()

  const cookie = await sessionCookie(adminPage)
  expect(cookie.httpOnly).toBe(true)

  // The flag is only worth anything if the page really cannot read the value:
  // an XSS on this origin must not be able to walk off with a live session.
  const visibleToScripts = await adminPage.evaluate(() => document.cookie)
  expect(visibleToScripts).not.toContain(SESSION_COOKIE)
  expect(visibleToScripts).not.toContain(cookie.value)
})

test('a session deleted on the server sends the next navigation to the login form', async ({
  adminPage,
}) => {
  await adminPage.goto('/')
  await expect(adminPage.getByRole('heading', { name: 'Helpdesk' })).toBeVisible()

  // What a session cleanup, or an admin ending someone's session, looks like to
  // a browser that is already sitting on a page.
  const cookie = await sessionCookie(adminPage)
  await deleteSessionByToken(cookie.value)

  await adminPage.goto('/tickets')

  await expect(adminPage).toHaveURL('/login')
  await expect(adminPage.getByRole('heading', { name: 'Sign in' })).toBeVisible()
})
