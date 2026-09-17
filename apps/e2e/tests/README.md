# End-to-end tests

Playwright specs live here. The harness is configured in `../playwright.config.ts`,
the database is prepared by `../prepare-database.ts`, and `../global-setup.ts`
checks that preparation happened.

Before the first run, install the browser:

```sh
bun --filter '@helpdesk/e2e' exec playwright install chromium
```

Then, from the repo root:

```sh
bun run test:e2e
```

Every run migrates and truncates `helpdesk_e2e` and seeds one admin, whose
credentials are in `../config.ts`. The development database is never touched:
Playwright starts its own API on port 3100 and its own web server on 5273, so a
run cannot reach the servers on 3000 and 5173.

## Writing a spec

Import `test` and `expect` from `../fixtures.ts`, never from `@playwright/test`
directly — the fixtures there carry the sign-in helpers and the cleanup.

| Fixture | Gives you |
| --- | --- |
| `signIn(credentials)` | A session in the page's browser context, over the API |
| `adminPage` | A page already signed in as the seeded admin |
| `createTestUser(options)` | A user with an address unique to the test, deleted afterwards |

`../database.ts` reaches `helpdesk_e2e` directly, for the setup and assertions
no endpoint offers: making users before Phase 2 ships the endpoint, and checking
session rows, which nothing exposes. Everything the spec is actually testing
goes through the browser.

The database is prepared once per run, not per test, so:

- Never assert on a total. Scope every count to a row the spec created.
- Give anything a spec creates a name of its own, and delete it afterwards.
  `createTestUser` does both; the fixtures also drop the session the test's
  browser is holding when it finishes.
- Never let one spec depend on another having run. The suite must pass run twice
  in a row without re-preparing the database in between.
