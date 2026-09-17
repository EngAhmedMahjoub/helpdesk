/**
 * Settings shared by the Playwright config and the global setup.
 *
 * Ports deliberately differ from the development servers on 3000 and 5173.
 * Sharing them would let a run reuse whatever is already listening — an API
 * pointed at the development database — and quietly wreck real data while
 * appearing to pass.
 */
export const API_PORT = Number(process.env.E2E_API_PORT ?? 3100)
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5273)

export const API_URL = `http://localhost:${String(API_PORT)}`
export const WEB_URL = `http://localhost:${String(WEB_PORT)}`

/**
 * A third database, beside `helpdesk` for development and `helpdesk_test` for
 * the unit and integration suites. Separate from `helpdesk_test` on purpose:
 * that one is truncated between tests, so a suite running in parallel would
 * pull rows out from under a browser mid-assertion.
 *
 * Overridable so CI can point at its own service container.
 */
export const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'postgresql://helpdesk:helpdesk@localhost:5432/helpdesk_e2e?schema=public'

/** Seeded by the global setup; tests sign in as this account. */
export const ADMIN = {
  email: 'e2e-admin@helpdesk.test',
  password: 'e2e-admin-password-not-a-secret',
  name: 'E2E Admin',
} as const
