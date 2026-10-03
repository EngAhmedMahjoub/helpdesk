import { deleteSessionByToken } from '../database.ts'
import { expect, sessionCookie, test } from '../fixtures.ts'

test('a logged-out visitor is sent to the login form', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveURL('/login')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
})

test('a session deleted on the server sends the next navigation to the login form', async ({
  adminPage,
}) => {
  await adminPage.goto('/')
  await expect(adminPage.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()

  // What a session cleanup, or an admin ending someone's session, looks like to
  // a browser that is already sitting on a page.
  const cookie = await sessionCookie(adminPage)
  await deleteSessionByToken(cookie.value)

  await adminPage.goto('/tickets')

  await expect(adminPage).toHaveURL('/login')
  await expect(adminPage.getByRole('heading', { name: 'Sign in' })).toBeVisible()
})
