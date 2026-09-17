# End-to-end tests

Playwright specs live here. The harness is configured in `../playwright.config.ts`
and the database is prepared by `../global-setup.ts`.

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
