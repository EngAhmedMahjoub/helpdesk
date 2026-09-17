import { findSessionByToken } from '../database.ts'
import { expect, findSessionCookie, sessionCookie, test } from '../fixtures.ts'

test('signing out returns to the login form and deletes the session', async ({ adminPage }) => {
  await adminPage.goto('/')
  const cookie = await sessionCookie(adminPage)

  await adminPage.getByRole('button', { name: 'Sign out' }).click()

  await expect(adminPage).toHaveURL('/login')
  await expect(adminPage.getByRole('heading', { name: 'Sign in' })).toBeVisible()

  // The row itself, not just the cookie: a token whose session outlived the
  // sign-out would still authenticate anyone who kept a copy of it.
  await expect.poll(() => findSessionByToken(cookie.value)).toBeNull()
  expect(await findSessionCookie(adminPage)).toBeUndefined()
})

test('the dashboard is not served from cache after signing out', async ({ adminPage }) => {
  await adminPage.goto('/')
  await adminPage.getByRole('button', { name: 'Sign out' }).click()
  await expect(adminPage).toHaveURL('/login')

  await adminPage.goto('/')

  await expect(adminPage).toHaveURL('/login')
  await expect(adminPage.getByRole('heading', { name: 'Sign in' })).toBeVisible()
})
