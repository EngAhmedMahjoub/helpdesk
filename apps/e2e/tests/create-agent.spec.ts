import type { Page } from '@playwright/test'
import { countUsersWithEmail } from '../database.ts'
import { expect, test } from '../fixtures.ts'

type AgentDetails = { name: string; email: string; password: string }

/** Opens the dialog and submits it, leaving the page wherever the app takes it. */
async function addAgent(page: Page, agent: AgentDetails): Promise<void> {
  await page.getByRole('button', { name: 'Add agent' }).click()

  const dialog = page.getByRole('dialog', { name: 'Add agent' })
  await dialog.getByLabel('Name').fill(agent.name)
  await dialog.getByLabel('Email').fill(agent.email)
  await dialog.getByLabel('Initial password').fill(agent.password)
  await dialog.getByRole('button', { name: 'Add agent' }).click()
}

test('an agent an admin adds can sign in with the initial password', async ({
  adminPage,
  browser,
  claimEmail,
}) => {
  const agent = {
    // Label without "agent" in it: the role cell is matched by name, and an
    // address containing "agent" would put that word in the email cell too.
    email: claimEmail('created-by-admin'),
    name: 'E2E Created Via Dialog',
    password: 'initial-password-not-a-secret',
  }

  await test.step('the admin adds the agent from the users page', async () => {
    await adminPage.goto('/users')
    await addAgent(adminPage, agent)

    await expect(adminPage.getByRole('dialog', { name: 'Add agent' })).toBeHidden()
    // Filtered: the table skeleton is a status region too, while a list loads.
    const announcement = adminPage.getByRole('status').filter({ hasText: agent.name })
    await expect(announcement).toHaveText(`${agent.name} was added and can sign in now.`)

    const row = adminPage.getByRole('row').filter({ hasText: agent.email })
    await expect(row.getByRole('cell', { name: agent.name, exact: true })).toBeVisible()
    await expect(row.getByRole('cell', { name: 'agent', exact: true })).toBeVisible()
    await expect(row.getByRole('cell', { name: 'Active', exact: true })).toBeVisible()
  })

  await test.step('the new agent signs in through the form', async () => {
    // A context of its own, so the agent's sign-in cannot ride on the admin's
    // cookie: a pass here means the agent's own credentials got them in. Their
    // session row goes with the user when claimEmail deletes it.
    const agentContext = await browser.newContext()
    try {
      const agentPage = await agentContext.newPage()
      await agentPage.goto('/login')
      await agentPage.getByLabel('Email').fill(agent.email)
      await agentPage.getByLabel('Password').fill(agent.password)
      await agentPage.getByRole('button', { name: 'Sign in' }).click()

      await expect(agentPage).toHaveURL('/')
      await expect(agentPage.getByRole('heading', { name: 'Helpdesk' })).toBeVisible()
      // The API fixes the role rather than reading it from the form, so the
      // account must come out an agent with no way to the users screen.
      const nav = agentPage.getByRole('navigation', { name: 'Main' })
      await expect(nav.getByRole('link', { name: 'Tickets' })).toBeVisible()
      await expect(nav.getByRole('link', { name: 'Users' })).toBeHidden()
    } finally {
      await agentContext.close()
    }
  })
})

test('adding an agent with a taken email keeps the dialog open with the error on Email', async ({
  adminPage,
  createTestUser,
}) => {
  const existing = await createTestUser({ label: 'taken-address' })

  await adminPage.goto('/users')
  await addAgent(adminPage, {
    name: 'E2E Duplicate Attempt',
    email: existing.email,
    password: 'initial-password-not-a-secret',
  })

  const dialog = adminPage.getByRole('dialog', { name: 'Add agent' })
  // Each field is an unnamed group holding its label, input and error; scoping
  // to the one holding Email proves the message landed on that field and not
  // in a banner above the form.
  const emailField = dialog.getByRole('group').filter({ has: adminPage.getByLabel('Email') })
  await expect(emailField.getByRole('alert')).toHaveText('A user with that email already exists')
  await expect(dialog.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true')
  await expect(dialog).toBeVisible()

  // Checked in the database rather than the list: the modal hides the page
  // behind it from the accessibility tree, so no row assertion there could fail.
  expect(await countUsersWithEmail(existing.email)).toBe(1)
})
