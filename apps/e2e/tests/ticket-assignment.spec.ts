import type { Locator, Page } from '@playwright/test'
import { API_URL } from '../config.ts'
import { uniqueSubject } from '../database.ts'
import { expect, test } from '../fixtures.ts'
import { chooseOption, ownRows, ticketRow } from '../tickets-page.ts'
import { announcement, openEditDialog, signInElsewhere } from '../users-page.ts'

/**
 * The assignee select is controlled by the ticket the API answered with, which
 * the mutation caches on success. So the trigger naming someone is the PATCH
 * having landed, and there is nothing to sleep on before reloading.
 */
function assigneeSelect(page: Page): Locator {
  return page.getByLabel('Assignee', { exact: true })
}

test('an agent who takes a ticket still holds it after a reload', async ({
  page,
  signIn,
  createTestUser,
  createTestTicket,
}) => {
  const agent = await createTestUser({ label: 'assign-to-me' })
  const ticket = await createTestTicket({
    subject: `${uniqueSubject('assign-to-me')} locked out of the portal`,
  })
  const assignee = assigneeSelect(page)
  const assignToMe = page.getByRole('button', { name: 'Assign to me', exact: true })

  // An agent rather than the seeded admin: assignment is open to both, and this
  // is the one the shortcut is written for.
  await signIn(agent)
  await page.goto(`/tickets/${String(ticket.id)}`)

  await test.step('the ticket arrives with nobody on it', async () => {
    await expect(assignee).toHaveText('Unassigned')
    await expect(assignToMe).toBeVisible()
  })

  await test.step('Assign to me puts the agent on it', async () => {
    await assignToMe.click()

    await expect(assignee).toHaveText(agent.name)
    // Nothing left to offer once the ticket is already theirs.
    await expect(assignToMe).toBeHidden()
  })

  await test.step('the assignment is still there after a reload', async () => {
    await page.reload()

    await expect(assignee).toHaveText(agent.name)
    await expect(assignToMe).toBeHidden()
  })
})

test('a ticket handed to another agent reaches them under Assigned to me', async ({
  page,
  browser,
  signIn,
  createTestUser,
  createTestTicket,
}) => {
  const prefix = uniqueSubject('handover')
  const sender = await createTestUser({ label: 'handover-sender' })
  // Labels differ, so the names the select offers do too: the list holds every
  // active user in the database, including the ones other specs are running.
  const receiver = await createTestUser({ label: 'handover-receiver' })
  const handed = await createTestTicket({ subject: `${prefix} refund for the March cohort` })
  // A second ticket of this spec's own, left with nobody on it, so the filter is
  // seen to narrow rather than to list whatever the receiver can see.
  await createTestTicket({ subject: `${prefix} password reset loop` })

  await signIn(sender)
  // A context of the receiver's own: the handover has to travel through the
  // server, not through a cookie or a cache the two pages share.
  const signedIn = await signInElsewhere(browser, receiver)

  try {
    await test.step('one agent hands the ticket to the other', async () => {
      await page.goto(`/tickets/${String(handed.id)}`)
      await chooseOption(page, 'Assignee', receiver.name)

      await expect(assigneeSelect(page)).toHaveText(receiver.name)
    })

    await test.step('the receiver finds it under Assigned to me', async () => {
      await signedIn.page.goto('/tickets')
      await chooseOption(signedIn.page, 'Assignee', 'Assigned to me')

      // Only this spec's rows: the filter is the receiver's, but the table is
      // the whole run's, so a count or a total would say nothing.
      await expect(ownRows(signedIn.page, prefix)).toHaveText([new RegExp(handed.subject)])
      await expect(
        ticketRow(signedIn.page, handed.subject).getByRole('cell', {
          name: receiver.name,
          exact: true,
        }),
      ).toBeVisible()
    })
  } finally {
    await signedIn.context.close()
  }
})

test('deactivating an agent hands back the ticket they were holding', async ({
  adminPage,
  createTestUser,
  createTestTicket,
}) => {
  const agent = await createTestUser({ label: 'deactivated-holder' })
  const ticket = await createTestTicket({
    subject: `${uniqueSubject('deactivated-holder')} broken video player`,
  })

  // Assigned over HTTP: the spec above is the one testing the select, and what
  // this one is about is what deactivation does to an assignment already made.
  // The context's request carries the admin's cookie.
  const assigned = await adminPage.request.patch(`${API_URL}/api/tickets/${String(ticket.id)}`, {
    data: { assigneeId: agent.id },
  })
  await expect(assigned).toBeOK()

  await test.step('the admin deactivates the agent', async () => {
    await adminPage.goto('/users')
    const dialog = await openEditDialog(adminPage, agent)
    await dialog.getByRole('button', { name: `Deactivate ${agent.name}`, exact: true }).click()

    const confirm = adminPage.getByRole('alertdialog', { name: `Deactivate ${agent.name}?` })
    await confirm.getByRole('button', { name: 'Deactivate' }).click()

    await expect(announcement(adminPage, agent.name)).toHaveText(
      `${agent.name} was deactivated and signed out.`,
    )
  })

  await test.step('their ticket comes back unassigned', async () => {
    await adminPage.goto(`/tickets/${String(ticket.id)}`)

    await expect(assigneeSelect(adminPage)).toHaveText('Unassigned')
  })
})
