import { API_URL } from '../config.ts'
import { countSessionsFor, findSessionByToken } from '../database.ts'
import { expect, sessionCookie, test } from '../fixtures.ts'
import { announcement, openEditDialog, signInElsewhere, userRow } from '../users-page.ts'

test('an agent the admin deactivates is signed out on their next page load', async ({
  adminPage,
  browser,
  createTestUser,
}) => {
  const agent = await createTestUser({ label: 'deactivated-by-admin' })
  const signedIn = await signInElsewhere(browser, agent)

  try {
    // Checked first so that "gone" below means deleted, not never there.
    expect(await findSessionByToken(signedIn.token)).not.toBeNull()

    await test.step('the admin deactivates the agent from the edit dialog and confirms', async () => {
      await adminPage.goto('/users')
      const dialog = await openEditDialog(adminPage, agent)
      await dialog.getByRole('button', { name: `Deactivate ${agent.name}`, exact: true }).click()

      const confirm = adminPage.getByRole('alertdialog', { name: `Deactivate ${agent.name}?` })
      await confirm.getByRole('button', { name: 'Deactivate' }).click()

      await expect(confirm).toBeHidden()
      await expect(dialog).toBeHidden()
      await expect(announcement(adminPage, agent.name)).toHaveText(
        `${agent.name} was deactivated and signed out.`,
      )
      const row = userRow(adminPage, agent.email)
      await expect(row.getByRole('cell', { name: 'Deactivated', exact: true })).toBeVisible()
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
  const signedIn = await signInElsewhere(browser, agent)

  try {
    // Setup, not the behaviour under test: the deactivation journey above
    // covers the dialog. Through the same endpoint so the old session is ended
    // the way the app ends it, not by a database write the app never makes.
    const deactivated = await adminPage.request.patch(`${API_URL}/api/users/${agent.id}`, {
      data: { isActive: false },
    })
    await expect(deactivated).toBeOK()

    await test.step('the admin reactivates the agent from the edit dialog', async () => {
      await adminPage.goto('/users')
      const dialog = await openEditDialog(adminPage, agent)
      await dialog.getByRole('button', { name: `Reactivate ${agent.name}`, exact: true }).click()

      await expect(dialog).toBeHidden()
      await expect(announcement(adminPage, agent.name)).toHaveText(
        `${agent.name} was reactivated and can sign in again.`,
      )
      const row = userRow(adminPage, agent.email)
      await expect(row.getByRole('cell', { name: 'Active', exact: true })).toBeVisible()
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
  const signedIn = await signInElsewhere(browser, agent)

  try {
    await adminPage.goto('/users')
    const dialog = await openEditDialog(adminPage, agent)
    const deactivate = dialog.getByRole('button', { name: `Deactivate ${agent.name}`, exact: true })
    await deactivate.click()

    const confirm = adminPage.getByRole('alertdialog', { name: `Deactivate ${agent.name}?` })
    await confirm.getByRole('button', { name: 'Cancel' }).click()

    await expect(confirm).toBeHidden()
    // Back in the edit dialog, still offering to deactivate: nothing was sent.
    await expect(deactivate).toBeVisible()

    // Exact: the Deactivate button's name holds this agent's label, and
    // "deactivation-cancelled" contains "cancel".
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toBeHidden()
    const row = userRow(adminPage, agent.email)
    await expect(row.getByRole('cell', { name: 'Active', exact: true })).toBeVisible()

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
