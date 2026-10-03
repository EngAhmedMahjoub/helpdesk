import { countSessionsFor, findSessionByToken } from '../database.ts'
import { expect, sessionCookie, test } from '../fixtures.ts'
import { submitLoginForm } from '../login-form.ts'
import { announcement, openEditDialog, signInElsewhere, userRow } from '../users-page.ts'

test('an agent whose email and password the admin changes signs in with the new ones', async ({
  adminPage,
  browser,
  createTestUser,
  claimEmail,
}) => {
  const agent = await createTestUser({ label: 'details-edited' })
  // Claimed as well as deleted by id: if the save lands but the test dies before
  // the fixture's id-based cleanup, the row still goes by the address it now has.
  const newEmail = claimEmail('details-edited-new')
  const newPassword = 'changed-by-admin-not-a-secret'
  const signedIn = await signInElsewhere(browser, agent)

  try {
    // Checked first so that "gone" below means deleted, not never there.
    expect(await findSessionByToken(signedIn.token)).not.toBeNull()

    await test.step('the admin changes the email and password in the dialog', async () => {
      await adminPage.goto('/users')
      const dialog = await openEditDialog(adminPage, agent)

      await expect(dialog.getByLabel('Name')).toHaveValue(agent.name)
      await expect(dialog.getByLabel('Email')).toHaveValue(agent.email)
      await expect(dialog.getByLabel('New password')).toHaveValue('')

      await dialog.getByLabel('Email').fill(newEmail)
      await dialog.getByLabel('New password').fill(newPassword)
      await dialog.getByRole('button', { name: 'Save changes' }).click()

      await expect(dialog).toBeHidden()
      await expect(announcement(adminPage, agent.name)).toHaveText(
        `${agent.name} was updated. They were signed out and must use the new password.`,
      )
      await expect(userRow(adminPage, newEmail)).toBeVisible()
    })

    await test.step("the agent's old session is deleted on the server", async () => {
      expect(await findSessionByToken(signedIn.token)).toBeNull()
      expect(await countSessionsFor(agent.id)).toBe(0)
    })

    await test.step('the agent is sent to the login form on their next page load', async () => {
      await signedIn.page.reload()

      await expect(signedIn.page).toHaveURL('/login')
      await expect(signedIn.page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    })

    const { page } = signedIn

    await test.step('the old email and password are refused', async () => {
      await submitLoginForm(page, agent)

      await expect(page.getByRole('alert')).toHaveText('Invalid email or password')
      await expect(page).toHaveURL('/login')
      expect(await countSessionsFor(agent.id)).toBe(0)
    })

    await test.step('the new email and password get the agent in', async () => {
      await submitLoginForm(page, { email: newEmail, password: newPassword })

      await expect(page).toHaveURL('/')
      await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()

      const { value: token } = await sessionCookie(page)
      expect(token).not.toBe(signedIn.token)
    })
  } finally {
    await signedIn.context.close()
  }
})
