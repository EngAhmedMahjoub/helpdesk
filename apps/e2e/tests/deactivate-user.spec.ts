import { countSessionsFor, findSessionByToken } from '../database.ts'
import { expect, test } from '../fixtures.ts'
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
      // talks to the API. A reload is the realistic trigger, and the one that
      // depends on nothing cached: a fresh load always asks /auth/me, whereas a
      // click only finds out if the page it lands on makes a request of its own.
      await signedIn.page.reload()

      await expect(signedIn.page).toHaveURL('/login')
      await expect(signedIn.page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    })
  } finally {
    await signedIn.context.close()
  }
})
