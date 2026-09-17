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
 * Today an agent who types the URL gets the page: the router guard only checks
 * for a session, and leaving the link out of the nav is convenience, not access
 * control. That is deliberate — the API is where roles are enforced, by
 * `requireAdmin` on every admin endpoint — and the page carries no data of its
 * own until task 2.4 wires it to `GET /api/users`, which will refuse an agent.
 *
 * This test records that behaviour rather than a boundary the app does not
 * have. When 2.4 lands, the thing to assert is that the agent's request for the
 * list is refused, not that the route is unreachable.
 */
test('an agent reaching /users by URL gets the page, because the API is the boundary', async ({
  page,
  signIn,
  createTestUser,
}) => {
  const agent = await createTestUser({ label: 'agent-direct-url', role: 'agent' })
  await signIn(agent)

  await page.goto('/users')

  await expect(page).toHaveURL('/users')
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible()
})
