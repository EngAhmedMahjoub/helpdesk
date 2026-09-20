import {
  test as base,
  expect,
  type APIRequestContext,
  type Cookie,
  type Page,
} from '@playwright/test'
import { ADMIN, API_URL } from './config.ts'
import {
  createTicket,
  createUser,
  deleteSessionByToken,
  deleteTickets,
  deleteUsers,
  deleteUsersByEmail,
  prisma,
  uniqueEmail,
  type NewTicket,
  type NewUser,
  type TestTicket,
  type TestUser,
} from './database.ts'

export { expect } from '@playwright/test'

/** Set by the API; the name lives in `apps/api/src/auth/session.ts`. */
export const SESSION_COOKIE = 'session'

export type Credentials = { email: string; password: string }

type WorkerFixtures = {
  /** Closes this worker's database connections after its last test. */
  databaseConnection: void
}

type TestFixtures = {
  /** Gives the page's browser context a session, without driving the form. */
  signIn: (credentials: Credentials) => Promise<void>
  /** A page already holding a session for the seeded admin. Navigate it yourself. */
  adminPage: Page
  /** Makes a user this test owns, and deletes it afterwards. */
  createTestUser: (options?: NewUser) => Promise<TestUser>
  /**
   * An address for a user the app itself will create, deleted afterwards.
   * createTestUser cannot clean those up: it never made them.
   */
  claimEmail: (label: string) => string
  /**
   * Makes a ticket this test owns, with its thread, and deletes it afterwards.
   *
   * Attribute a seeded agent message to the seeded admin, not to a user from
   * `createTestUser`: `Message.agentId` is Restrict, and the user fixture tears
   * down after this one, so its delete would hit a reply still pointing at it.
   */
  createTestTicket: (ticket: NewTicket) => Promise<TestTicket>
  /** Deletes whatever session the test's browser is still holding. */
  sessionCleanup: void
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  databaseConnection: [
    // Playwright reads a fixture's dependencies out of this destructuring
    // pattern and rejects any other shape of argument, so a fixture that
    // depends on nothing still has to destructure nothing.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await use()
      // Left open, the pool keeps the worker process alive past its last test
      // and Playwright has to kill it.
      await prisma.$disconnect()
    },
    { scope: 'worker', auto: true },
  ],

  signIn: async ({ page }, use) => {
    await use(async (credentials) => {
      // The context's request shares its cookie jar with the page, so logging
      // in over HTTP leaves the browser holding a real session cookie. Cookies
      // ignore the port, so one set by the API on localhost:3100 travels with
      // pages served from localhost:5273.
      //
      // Through the API rather than the form on purpose: only the sign-in spec
      // is testing the form, and every other spec would inherit its flakiness.
      await loginViaApi(page.request, credentials)
    })
  },

  adminPage: async ({ page, signIn }, use) => {
    await signIn(ADMIN)
    await use(page)
  },

  // eslint-disable-next-line no-empty-pattern
  createTestUser: async ({}, use) => {
    const created: string[] = []

    await use(async (options) => {
      const user = await createUser(options)
      created.push(user.id)
      return user
    })

    // The database is prepared once per run, so a row left behind here is a row
    // every later test in the run has to tolerate.
    await deleteUsers(created)
  },

  // eslint-disable-next-line no-empty-pattern
  claimEmail: async ({}, use) => {
    const claimed: string[] = []

    await use((label) => {
      const email = uniqueEmail(label)
      claimed.push(email)
      return email
    })

    // By address because the id was never ours to know. Runs even when the test
    // failed halfway, which is when a stray row is most likely.
    await deleteUsersByEmail(claimed)
  },

  // eslint-disable-next-line no-empty-pattern
  createTestTicket: async ({}, use) => {
    const created: number[] = []

    await use(async (ticket) => {
      const made = await createTicket(ticket)
      created.push(made.id)
      return made
    })

    // Messages go with them. The database is prepared once per run, so a ticket
    // left behind is one every later test in the run has to page past.
    await deleteTickets(created)
  },

  sessionCleanup: [
    async ({ page }, use) => {
      await use()

      // Sessions for the seeded admin outlive the test that made them: the
      // admin is shared, so nothing else can safely clear them, and over a
      // rerun without preparing the database they would pile up. Each test
      // knows its own token, so each test drops its own row.
      const cookie = await findSessionCookie(page)
      if (cookie) await deleteSessionByToken(cookie.value)
    },
    { auto: true },
  ],
})

/**
 * Logs in over HTTP. Pass a context's request, not the standalone one, when the
 * session should land in that context's browser: only it shares the cookie jar.
 */
export async function loginViaApi(
  request: APIRequestContext,
  credentials: Credentials,
): Promise<void> {
  const response = await request.post(`${API_URL}/api/auth/login`, { data: credentials })
  await expect(response).toBeOK()
}

/** The session cookie, or undefined when the browser is holding none. */
export async function findSessionCookie(page: Page): Promise<Cookie | undefined> {
  const cookies = await page.context().cookies()
  return cookies.find((cookie) => cookie.name === SESSION_COOKIE)
}

/** The session cookie, for tests where not having one is a failed setup. */
export async function sessionCookie(page: Page): Promise<Cookie> {
  const cookie = await findSessionCookie(page)

  if (!cookie) {
    throw new Error(`The browser holds no "${SESSION_COOKIE}" cookie; signing in did not happen.`)
  }

  return cookie
}
