# Tech Stack

## Overview

TypeScript monorepo on Bun: React + Vite frontend on Vercel, Express API running on Bun (with in-process background jobs) in Docker on Koyeb, PostgreSQL on Neon, Resend for email, and Claude for AI. All hosting uses free tiers (portfolio project).

## Repository

Bun workspaces (`bun.lock` at the root):

- `apps/web` (`@helpdesk/web`) — frontend
- `apps/api` (`@helpdesk/api`) — API and background jobs
- `packages/shared` (`@helpdesk/shared`) — shared types and Zod schemas, imported as TypeScript source via `workspace:*`

Root scripts:

| Command | Runs |
|---|---|
| `bun run dev` | API (`bun --watch`) and Vite dev server |
| `bun run typecheck` | `tsc` in every workspace |
| `bun run lint` | `oxlint --deny-warnings` in every workspace (warnings fail the run) |
| `bun run format` / `format:check` | Prettier write / check across the repo (Markdown excluded) |
| `bun run build` | Frontend production build |

## Installed Versions

As installed at scaffold time (2026-09-15):

| Package | Version |
|---|---|
| Bun | 1.4.2 |
| TypeScript | 6.0.3 (all workspaces) |
| Express | 5.2.1 |
| React / React DOM | 19.2 |
| Vite | 8.3 |
| @vitejs/plugin-react | 6.1 |
| oxlint | 1.83 (all workspaces) |
| axios | 1.20 (`apps/web`) |
| Prettier | 3.9 (root) |

## Frontend (`apps/web`)

| Concern | Choice |
|---|---|
| Framework | React + Vite + TypeScript |
| Routing | React Router 8 in data mode; route table in `src/routes.tsx`, browser router created in `App` |
| Data fetching | axios for the HTTP call, TanStack Query for server state — two jobs, two libraries. Never native `fetch`. Query client in `src/lib/query-client.ts`, no retries on 4xx |
| Tables | shadcn `Table`, with a visually hidden `<caption>`. Status and role read as words in a badge; the colour only seconds them, so nothing is lost by a reader who cannot tell two badges apart |
| UI | Tailwind CSS 4 (via `@tailwindcss/vite`) + shadcn/ui (radix base, nova preset); components in `src/components/ui`, imported through the `@/` alias |
| Forms | react-hook-form with `zodResolver`; shadcn `Field`/`FieldError`, `noValidate` so the schema's messages replace the browser's. A rejected request stays a form-level alert — marking a field would disclose which one the API refused to name |
| Linting | oxlint |
| API calls | `apiRequest` in `src/lib/api.ts` over an axios instance — `baseURL` from `VITE_API_URL`, `withCredentials: true`, and a response interceptor turning any HTTP failure into `ApiError`. A request that got no response at all is left alone, so the query client retries a dropped connection where it would not retry a 401 |
| Axios adapter | `adapter: 'fetch'` rather than the default xhr. It is what runs where the app ships, and it keeps one seam — global `fetch` — for the tests to stand in front of, instead of an XMLHttpRequest happy-dom would put on the wire for real |
| Local development | Vite dev server proxies `/api` to `http://localhost:3000` |
| Route protection | `RequireAuth` wraps every route but `/login`; `GET /api/auth/me` on load, 401 redirects to `/login`. `RequireAdmin` nests inside it around admin-only routes and sends a non-admin to `/` — signed in, so `/login` would name the wrong problem. `AppLayout` drops admin-only nav items for agents. All three are convenience, not a boundary; Express refuses the request either way |

Hiding screens in the UI is not access control. Express enforces permissions on every endpoint.

## Backend (`apps/api`)

| Concern | Choice |
|---|---|
| Runtime | Bun (runs TypeScript directly; no build step) |
| Framework | Express 5 + TypeScript |
| Validation | Zod 4 |
| Environment config | `apps/api/src/env.ts` validates `process.env` at import; invalid or missing variables print the problem and exit 1. `NODE_ENV` and `WEB_ORIGIN` carry no defaults on purpose — both decide how tightly the API is locked down, so a deploy that forgets one must fail to boot rather than quietly serve an insecure default. `ADMIN_EMAIL` / `ADMIN_PASSWORD` are seed-only and validated in `prisma/seed.ts` instead, so the API can start without them |
| ORM | Prisma |
| Database | PostgreSQL |
| Local database | `docker compose up -d --wait` at the repo root starts Postgres 18 on `localhost:5432` (user, password, and database `helpdesk`); copy `apps/api/.env.example` to `apps/api/.env` |
| Background jobs | pg-boss, running inside the API process (Koyeb's free instance cannot run a separate worker) |
| Scheduled tasks | GitHub Actions scheduled workflow calls protected endpoints (the API sleeps when idle, so in-process schedules are unreliable) |
| CORS | `cors` package, single origin from `WEB_ORIGIN` (`https://app.<domain>` in production, `http://localhost:5173` locally), `credentials: true` |
| Error handling | A body-parser failure answers its own status (400 unparseable, 413 over the 100KB default) and logs only the error type. The error object is never logged for a client error: `express.json()` attaches the raw body, which for a truncated login POST means a cleartext password in the log |
| End-to-end tests | Playwright in `apps/e2e`, Chromium. Starts its own API on 3100 and web server on 5273 against a third database, `helpdesk_e2e`, so a run cannot reach the development servers or their data. `bun run test:e2e` prepares the database before Playwright starts, because Playwright launches `webServer` ahead of `globalSetup` |
| Tests | `bun test` + Supertest (`apps/api/test`) against a real `helpdesk_test` database (`.env.test`, loaded automatically because `bun test` sets `NODE_ENV=test`); `bun run test` applies migrations first and truncates between tests. The web app uses `bun test` with happy-dom and Testing Library |

## Authentication

Database sessions.

| Piece | Design |
|---|---|
| Session table | Prisma `Session` model: `id`, `tokenHash`, `userId`, `expiresAt`, `createdAt` |
| Token | 32 random bytes (`crypto.randomBytes`); raw token in the cookie, SHA-256 hash in the database |
| Cookie | `httpOnly`, `Secure`, `SameSite=Lax`, set by `api.<domain>` |
| Passwords | `Bun.password` (argon2id, m=65536 KiB, t=2, p=1); no argon2 or bcrypt dependency |
| Expiry | 8 hours; expired sessions deleted by a scheduled task |
| Login | `POST /api/auth/login` creates a session and sets the cookie |
| Login timing | Always one argon2 verification, against a dummy hash when no account matches. Short-circuiting would answer an unknown address ~60x faster than a real one, which enumerates accounts however uniform the response body is |
| Login rate limit | `express-rate-limit`, 10 attempts per 15 minutes, keyed by IP *and* submitted address so one target cannot exhaust another's budget. Counts successes too. **Production only** — it guards an endpoint facing the internet, and locally would only throttle whoever is building the screens that sign in. Safe to gate on `NODE_ENV` because it has no default, so a deploy that omits it refuses to boot. Needs `trust proxy` set once the API sits behind Koyeb's proxy (task 8.5) |
| Logout | `POST /api/auth/logout` deletes the session and clears the cookie |
| Current user | `GET /api/auth/me` returns `{ id, email, name, role }` or 401 |
| Request middleware | Hash cookie token, load session + user, reject if missing, expired, or user deactivated |
| Deactivating an agent | Mark user inactive and delete all their sessions |
| First admin | `bun run db:seed` upserts on email using `ADMIN_EMAIL` / `ADMIN_PASSWORD`; re-running never resets the password |
| Agent creation | `POST /api/users`, admin only |

## User Management

| Concern | Choice |
|---|---|
| Routes | `apps/api/src/routes/users.ts`, mounted at `/api/users`. `requireAuth` and `requireAdmin` are applied to the router, not to each route, so a route added later cannot be left unguarded by omission |
| List response | `GET /api/users` returns every user — active and deactivated — as `{ id, email, name, role, isActive, createdAt }`, oldest first with `id` breaking ties. The `UserSummary` type in `@helpdesk/shared` is the contract |
| Field selection | An explicit Prisma `select`, never an `omit` of `passwordHash`: a column added to `User` later is then absent from the response until someone chooses to expose it |
| Creating an agent | `POST /api/users` takes `{ email, name, password }` and answers 201 with a `UserSummary`. `role` is fixed to `agent` in code and never read from the body, so one stolen admin session cannot mint a second admin. Password minimum 12, matching `ADMIN_PASSWORD` in the seed, capped at 200 so a 100KB body never reaches argon2 |
| Duplicate address | The unique index decides, not a `findUnique` first: the `P2002` violation is mapped to 409. Check-then-insert would let two concurrent requests both pass the check and turn one into a 500. Addresses are lowercased before the insert, because login looks them up lowercased — a row stored with capitals would be an account nobody could sign in to |
| Deactivating and reactivating | `PATCH /api/users/:id` takes `{ isActive }` alone. Deactivation flips the flag and deletes the user's sessions in one transaction, so the rows cannot outlive the flag. `requireAuth` refusing an inactive user is what actually locks them out; deleting the sessions is what stops a later reactivation handing back tokens that were live weeks ago — reactivation restores the account, never a session |
| Deactivating yourself | Refused with 409. It would delete the session making the request, and with one admin nobody would be left who could undo it. Another admin can still deactivate them, so no admin account is unremovable |
| Unknown user | 404 for an id with no row (Prisma `P2025`) and for a malformed id alike — neither names a user, and letting a non-uuid reach Postgres raises on the cast rather than missing cleanly |

## Tickets

| Concern | Rule |
|---|---|
| Statuses | Open, Resolved, Closed |
| Categories | General question, Technical question, Refund request |
| Resolved | Issue is solved. Set by the AI or an agent. |
| Closed | Ticket is no longer open. Set by an agent or by auto-close. |
| Auto-close | A Resolved ticket closes 14 days after it was resolved. Open and Closed tickets have no timer. |
| Timer reset | A student message on a Resolved ticket restarts the 14-day timer. |
| Student reply to Resolved or Closed | Status does not change. AI processes the new message: replies and updates category and summary. |
| Escalation | Ticket flagged `needsAgent` with reason `refund_approval` or `ai_failed` |

## Email

| Concern | Choice |
|---|---|
| Provider | Resend (free tier includes receiving) |
| Inbound | Resend receiving webhook → Express creates or updates ticket and queues a job |
| Outbound | Resend, with `In-Reply-To` set so replies stay in the student's thread |
| Domain | Receiving via MX record on a subdomain of `<domain>` |

Free tier limits (from search results, not verified on Resend's pricing page): 3,000 emails/month and 100/day, shared between sent and received.

## AI

| Concern | Choice |
|---|---|
| Model | `claude-opus-5` via the Anthropic TypeScript SDK |
| Call | One call per new inbound message, returning category, summary, and reply draft as structured JSON |
| Knowledge base | Markdown files in a cached system prompt; no vector database |
| General / technical questions | Reply sent automatically; status set to Resolved (except on Closed tickets, where status does not change) |
| Refund requests | Draft saved; ticket flagged `needsAgent` (`refund_approval`); agent approves before sending |
| Refund safeguard | Keyword check on the email and draft forces refund handling |
| Failure after retries | Ticket flagged `needsAgent` (`ai_failed`) |
| Billing | Anthropic API usage is billed separately from a Claude Pro subscription |

## Ticket Flow

1. Email arrives → Resend webhook → Express saves the message (new ticket as Open, or added to an existing ticket) and queues a job.
2. Background job calls Claude → category, summary, reply draft.
3. General or technical question → reply sent; ticket set to Resolved (unless Closed).
4. Refund request → draft saved; ticket flagged for an agent.
5. AI failure after retries → ticket flagged for an agent.

## Deployment

All free tiers.

| Piece | Provider |
|---|---|
| Frontend | Vercel (Hobby) on `app.<domain>` |
| API + background jobs | Koyeb free instance, Docker image based on `oven/bun`, on `api.<domain>` |
| Database | Neon free Postgres |
| Email | Resend free |
| Scheduled tasks | GitHub Actions scheduled workflow |
| CI/CD | GitHub Actions. `.github/workflows/ci.yml` runs on every PR and push to `main`: Bun 1.4.2, `bun install --frozen-lockfile`, `prisma generate` (the client is gitignored), then lint, typecheck, test, format:check. A `postgres:18` service container backs the database tests |

Not free: Anthropic API usage. The custom domain is already owned.

### Domains

Frontend and API must be subdomains of one custom domain so the session cookie works:

- `app.<domain>` → Vercel
- `api.<domain>` → Koyeb

Do not serve the app from `*.vercel.app` in production; the browser treats it as a different site and blocks the session cookie. Vercel preview deployments cannot log in; use them for UI review only.

### Free tier constraints

From search results, not verified on providers' pricing pages:

| Provider | Limit | Effect |
|---|---|---|
| Koyeb | One instance, 512 MB RAM, 0.1 vCPU; sleeps after 1 hour without traffic | First request after idle is slow; background jobs run only while awake |
| Neon | 0.5 GB storage, 100 compute-hours/month; sleeps when idle | Enough for a portfolio |
| Resend | 3,000 emails/month, 100/day (sent + received) | Enough for a demo |

### Pipelines

- **Frontend:** Vercel builds and deploys on push.
- **Backend:** GitHub Actions → build image → run `prisma migrate deploy` against Neon → deploy to Koyeb.
- **Scheduled tasks:** GitHub Actions workflow on a schedule calls `POST /api/tasks/auto-close` and `POST /api/tasks/cleanup-sessions`, protected by a shared secret.

When an API change and a frontend change ship together, deploy the backend first.

## To Verify During Setup

Checked with Context7 docs and a running scaffold: Bun workspaces, Express on Bun, Vite React TypeScript template, Vite dev proxy, Prisma 7 migrations on Bun (`bun run db:migrate` against the compose Postgres), `Bun.password`.

Not checked against current documentation:

- Library versions and APIs: React Router, TanStack Query, Tailwind CSS, shadcn/ui, Zod, pg-boss, Resend SDK.
- Bun compatibility: pg-boss. Prisma (client and `migrate dev`), Supertest, and `Bun.password` are confirmed working on Bun; `bun test` replaced Vitest, and `Bun.password` removed the need for an argon2 or bcrypt dependency.
- Free tier limits for Koyeb, Neon, and Resend on their pricing pages.
- Cross-subdomain session cookie between Vercel and Koyeb — test a real login early.
