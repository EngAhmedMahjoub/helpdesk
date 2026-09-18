import type { Browser, BrowserContext, Page } from '@playwright/test'
import { API_URL } from '../config.ts'
import { countSessionsFor, findSessionByToken, type TestUser } from '../database.ts'
import { expect, sessionCookie, test, type Credentials } from '../fixtures.ts'

type SignedInAgent = { context: BrowserContext; page: Page; token: string }

/**
 * The agent gets a browser context of their own, so nothing they do can ride on
 * the admin's cookie and nothing the admin does can reach the agent except
 * through the server. Their session row goes with the user when createTestUser
 * deletes it.
 */
async function signInAgentElsewhere(browser: Browser, agent: Credentials): Promise<SignedInAgent> {
  const context = await browser.newContext()
  const page = await context.newPage()

  const response = await page.request.post(`${API_URL}/api/auth/login`, { data: agent })
  await expect(response).toBeOK()

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Helpdesk' })).toBeVisible()

  const { value: token } = await sessionCookie(page)
  return { context, page, token }
}

/** Matched by address: names are only unique per label, addresses per test. */
function userRow(page: Page, user: TestUser) {
  return page.getByRole('row').filter({ hasText: user.email })
}

function announcement(page: Page, user: TestUser) {
  // Filtered: the table skeleton is a status region too, while the list loads.
  return page.getByRole('status').filter({ hasText: user.name })
}

test('an agent the admin deactivates is signed out on their next page load', async ({
  adminPage,
  browser,
  createTestUser,
}) => {
  const agent = await createTestUser({ label: 'deactivated-by-admin' })
  const signedIn = await signInAgentElsewhere(browser, agent)

  try {
    // Checked first so that "gone" below means deleted, not never there.
    expect(await findSessionByToken(signedIn.token)).not.toBeNull()

    await test.step('the admin deactivates the agent and confirms', async () => {
      await adminPage.goto('/users')
      const row = userRow(adminPage, agent)
      await row.getByRole('button', { name: `Deactivate ${agent.name}` }).click()

      const confirm = adminPage.getByRole('alertdialog', { name: `Deactivate ${agent.name}?` })
      await confirm.getByRole('button', { name: 'Deactivate' }).click()

      await expect(confirm).toBeHidden()
      await expect(announcement(adminPage, agent)).toHaveText(
        `${agent.name} was deactivated and signed out.`,
      )
      await expect(row.getByRole('cell', { name: 'Deactivated', exact: true })).toBeVisible()
      await expect(row.getByRole('button', { name: `Reactivate ${agent.name}` })).toBeVisible()
    })

    await test.step('the session row is deleted on the server', async () => {
      // requireAuth already refuses an inactive user, so the redirect below
      // would pass even if the rows survived. Only this proves they did not,
      // and a surviving row is what reactivation would hand back.
      expect(await findSessionByToken(signedIn.token)).toBeNull()
      expect(await countSessionsFor(agent.id)).toBe(0)
    })

    await test.step('the agent is sent to the login form on their next page load', async () => {
      // There is no push channel: the agent's tab learns nothing until it next
      // talks to the API. A reload is the realistic trigger, because a fresh
      // load always asks /auth/me. Clicking to /tickets would not do: the
      // dashboard's health check is unauthenticated, the placeholder pages make
      // no request, and the cached current user stays fresh for 30 seconds.
      await signedIn.page.reload()

      await expect(signedIn.page).toHaveURL('/login')
      await expect(signedIn.page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    })
  } finally {
    await signedIn.context.close()
  }
})

test('a reactivated agent must sign in again through the form', async ({
  adminPage,
  browser,
  createTestUser,
}) => {
  const agent = await createTestUser({ label: 'reactivated-by-admin' })
  const signedIn = await signInAgentElsewhere(browser, agent)

  try {
    // Setup, not the behaviour under test: the deactivation journey above
    // covers the dialog. Through the same endpoint so the old session is ended
    // the way the app ends it, not by a database write the app never makes.
    const deactivated = await adminPage.request.patch(`${API_URL}/api/users/${agent.id}`, {
      data: { isActive: false },
    })
    await expect(deactivated).toBeOK()

    await test.step('the admin reactivates the agent', async () => {
      await adminPage.goto('/users')
      const row = userRow(adminPage, agent)
      await row.getByRole('button', { name: `Reactivate ${agent.name}` }).click()

      await expect(announcement(adminPage, agent)).toHaveText(
        `${agent.name} was reactivated and can sign in again.`,
      )
      await expect(row.getByRole('cell', { name: 'Active', exact: true })).toBeVisible()
      await expect(row.getByRole('button', { name: `Deactivate ${agent.name}` })).toBeVisible()
    })

    await test.step('the session from before deactivation stays dead', async () => {
      // The agent's browser still holds the old cookie. If reactivation could
      // revive it, this reload would land on the dashboard instead.
      await signedIn.page.reload()

      await expect(signedIn.page).toHaveURL('/login')
      expect(await findSessionByToken(signedIn.token)).toBeNull()
    })

    await test.step('the agent signs in with their password', async () => {
      const { page } = signedIn
      await page.getByLabel('Email').fill(agent.email)
      await page.getByLabel('Password').fill(agent.password)
      await page.getByRole('button', { name: 'Sign in' }).click()

      await expect(page).toHaveURL('/')
      await expect(page.getByRole('heading', { name: 'Helpdesk' })).toBeVisible()

      const { value: token } = await sessionCookie(page)
      expect(token).not.toBe(signedIn.token)
    })
  } finally {
    await signedIn.context.close()
  }
})

test('cancelling the confirmation leaves the agent active and signed in', async ({
  adminPage,
  browser,
  createTestUser,
}) => {
  const agent = await createTestUser({ label: 'deactivation-cancelled' })
  const signedIn = await signInAgentElsewhere(browser, agent)

  try {
    await adminPage.goto('/users')
    const row = userRow(adminPage, agent)
    await row.getByRole('button', { name: `Deactivate ${agent.name}` }).click()

    const confirm = adminPage.getByRole('alertdialog', { name: `Deactivate ${agent.name}?` })
    await confirm.getByRole('button', { name: 'Cancel' }).click()

    await expect(confirm).toBeHidden()
    await expect(row.getByRole('cell', { name: 'Active', exact: true })).toBeVisible()
    await expect(row.getByRole('button', { name: `Deactivate ${agent.name}` })).toBeVisible()

    expect(await findSessionByToken(signedIn.token)).not.toBeNull()

    // The same trigger that throws a deactivated agent out, so a pass here is
    // not just a request that never happened.
    await signedIn.page.reload()
    await expect(signedIn.page).toHaveURL('/')
    await expect(signedIn.page.getByRole('heading', { name: 'Helpdesk' })).toBeVisible()
  } finally {
    await signedIn.context.close()
  }
})
