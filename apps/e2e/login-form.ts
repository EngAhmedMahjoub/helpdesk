import type { Page } from '@playwright/test'
import type { Credentials } from './fixtures.ts'

/**
 * Fills and submits the form on the page as it stands. It does not navigate:
 * several journeys are already on /login after a reload threw them out, and a
 * fresh goto there would hide whether that redirect happened.
 */
export async function submitLoginForm(page: Page, credentials: Credentials): Promise<void> {
  await page.getByLabel('Email').fill(credentials.email)
  await page.getByLabel('Password').fill(credentials.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}
