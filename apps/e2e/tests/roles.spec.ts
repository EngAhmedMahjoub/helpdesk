import { ADMIN } from '../config.ts'
import { expect, test } from '../fixtures.ts'

test('an admin sees the Users link', async ({ adminPage }) => {
  await adminPage.goto('/')

  const nav = adminPage.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByRole('link', { name: 'Users' })).toBeVisible()
})

test('an agent does not see the Users link', async ({ page, signIn, createTestUser }) => {
  const agent = await createTestUser({ label: 'agent', role: 'agent' })
  await signIn(agent)

  await page.goto('/')

  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByRole('link', { name: 'Tickets' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Users' })).toBeHidden()
})

/**
 * The redirect is a courtesy, not the boundary: `requireAdmin` on
 * `GET /api/users` is, and it answers an agent 403 whatever the browser does.
 * Sending them home spares them a screen that could only ever show that error,
 * the same way leaving the link out of the nav spares them the trip.
 */
test('an agent reaching /users by URL is sent back to the dashboard', async ({
  page,
  signIn,
  createTestUser,
}) => {
  const agent = await createTestUser({ label: 'agent-direct-url', role: 'agent' })
  await signIn(agent)

  await page.goto('/users')

  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: 'Helpdesk' })).toBeVisible()
  await expect(page.getByRole('table', { name: 'Users' })).toBeHidden()
})

test('an admin sees the users on the list', async ({ adminPage, createTestUser }) => {
  // Label without "agent" in it: the label goes into the address, and a role
  // cell matched by name would then also match the email cell beside it.
  const agent = await createTestUser({ label: 'listed-user', role: 'agent' })

  await adminPage.goto('/users')

  // Scoped to the two rows this spec can vouch for. The database is prepared
  // once per run, so every other spec's users are on this page too and a row
  // count would depend on whatever else happened to be running.
  const agentRow = adminPage.getByRole('row').filter({ hasText: agent.email })
  await expect(agentRow.getByRole('cell', { name: agent.name, exact: true })).toBeVisible()
  await expect(agentRow.getByRole('cell', { name: 'agent', exact: true })).toBeVisible()
  await expect(agentRow.getByRole('cell', { name: 'Active', exact: true })).toBeVisible()

  const adminRow = adminPage.getByRole('row').filter({ hasText: ADMIN.email })
  await expect(adminRow.getByRole('cell', { name: ADMIN.name, exact: true })).toBeVisible()
  await expect(adminRow.getByRole('cell', { name: 'admin', exact: true })).toBeVisible()
})
