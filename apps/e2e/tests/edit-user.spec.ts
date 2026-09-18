import { ADMIN, API_URL } from '../config.ts'
import { countSessionsFor, findSessionByToken, prisma } from '../database.ts'
import { expect, sessionCookie, test } from '../fixtures.ts'
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
      await page.getByLabel('Email').fill(agent.email)
      await page.getByLabel('Password').fill(agent.password)
      await page.getByRole('button', { name: 'Sign in' }).click()

      await expect(page.getByRole('alert')).toHaveText('Invalid email or password')
      await expect(page).toHaveURL('/login')
      expect(await countSessionsFor(agent.id)).toBe(0)
    })

    await test.step('the new email and password get the agent in', async () => {
      await page.getByLabel('Email').fill(newEmail)
      await page.getByLabel('Password').fill(newPassword)
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

test('an admin who is not the seeded admin can change only themselves and agents', async ({
  page,
  signIn,
  createTestUser,
}) => {
  const viewer = await createTestUser({ label: 'plain-admin', role: 'admin' })
  const otherAdmin = await createTestUser({ label: 'other-admin', role: 'admin' })
  const agent = await createTestUser({ label: 'editable-by-plain-admin' })
  await signIn(viewer)

  await page.goto('/users')

  await test.step('a pencil on their own row and on an agent’s', async () => {
    // Asserted before the absences below: until the list says who the viewer
    // is, every row shows the no-pencil text, and those checks would pass on a
    // page that had not finished deciding.
    await expect(
      userRow(page, viewer.email).getByRole('button', { name: `Edit ${viewer.name}`, exact: true }),
    ).toBeVisible()
    await expect(
      userRow(page, agent.email).getByRole('button', { name: `Edit ${agent.name}`, exact: true }),
    ).toBeVisible()
  })

  await test.step('no button on another admin’s row or the seeded admin’s', async () => {
    const otherRow = userRow(page, otherAdmin.email)
    await expect(otherRow.getByText('—')).toBeVisible()
    // Any button, not just the pencil: a renamed control would still be one.
    await expect(otherRow.getByRole('button')).toHaveCount(0)

    const seededRow = userRow(page, ADMIN.email)
    await expect(seededRow.getByText('Protected')).toBeVisible()
    await expect(seededRow.getByRole('button')).toHaveCount(0)
  })

  await test.step('the API refuses the change when it is sent anyway', async () => {
    // The hidden pencil is a courtesy; authorise() in the route is the boundary.
    const response = await page.request.patch(`${API_URL}/api/users/${otherAdmin.id}`, {
      data: { name: 'E2E Renamed Without Permission' },
    })

    expect(response.status()).toBe(403)
    expect(await response.json()).toEqual({
      error: 'Only the seeded admin can change another admin',
    })

    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: otherAdmin.id } })
    expect(unchanged.name).toBe(otherAdmin.name)
  })
})
