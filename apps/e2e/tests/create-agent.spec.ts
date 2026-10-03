import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures.ts'
import { submitLoginForm } from '../login-form.ts'
import { announcement, userRow } from '../users-page.ts'

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
    await expect(announcement(adminPage, agent.name)).toHaveText(
      `${agent.name} was added and can sign in now.`,
    )

    const row = userRow(adminPage, agent.email)
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
      await submitLoginForm(agentPage, agent)

      await expect(agentPage).toHaveURL('/')
      await expect(agentPage.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()
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
