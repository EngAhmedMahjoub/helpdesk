# Implementation Plan

Based on `project-scope.md` and `tech-stack.md`. Each task is small enough for one pull request. Phases run in order; tasks within a phase run mostly in order.

## Decisions

| Topic | Decision |
|---|---|
| Resolved vs Closed | Resolved = the issue is solved. Closed = the ticket is no longer open. The AI or an agent can set Resolved. Only an agent or the auto-close timer can set Closed. |
| Student replies to a Resolved or Closed ticket | Status does not change. The message is added to the ticket; the AI replies and updates category and summary. |
| Auto-close | Resolved tickets close 14 days after being resolved. Open and Closed tickets have no timer. |
| Timer reset | A student message on a Resolved ticket restarts the 14-day timer. |
| AI call fails after retries | Escalate to a human agent: ticket stays Open and is flagged as needing an agent. |
| Ticket assignment | A ticket has at most one assignee, an active agent or admin. Assignment is a label, not a permission: any agent or admin can assign, reassign or clear it, and anyone can still reply or change status. Deactivating a user clears their assignments. |
| Knowledge base content | Written with Claude Code as part of Phase 5. |
| Hosting | Free tiers: Vercel (frontend), Render (API + background jobs in one process; Koyeb until its free plan closed to new users), Neon (Postgres), Resend (email), GitHub Actions (CI/CD and scheduled tasks). |
| Runtime and package manager | Bun, with Bun workspaces |
| Custom domain | `helpdesk.mahjoub.io`, a subdomain of the owned `mahjoub.io` and already the Resend domain: the app on `app.helpdesk.mahjoub.io`, the API on `api.helpdesk.mahjoub.io`. The root stays free for personal use. |

## Decisions Still Needed

None.

## Phase 0 — Project Setup

| ID | Task | Done when | Status |
|---|---|---|---|
| 0.1 | Create Bun workspaces monorepo: `apps/web`, `apps/api`, `packages/shared` | `bun install` succeeds at root | Done |
| 0.2 | Typecheck script across workspaces | `bun run typecheck` passes in all workspaces | Done |
| 0.2a | oxlint across all workspaces (installed in `apps/web` by the Vite template), Prettier | `bun run lint` passes in all workspaces | Done |
| 0.3 | Docker Compose for local PostgreSQL | `docker compose up` starts Postgres; API can connect | Done |
| 0.4 | Express skeleton on Bun with `GET /api/health`, `/api` 404 handler, error handler | Health endpoint returns 200 | Done |
| 0.5 | Environment config loaded and validated with Zod | API refuses to start with a missing or invalid variable | Done |
| 0.6 | Vite + React + TypeScript skeleton; dev proxy `/api` → API; App calls the health check | Page shows API status | Done |
| 0.6a | Add Tailwind CSS and shadcn/ui | A shadcn/ui component renders | Done |
| 0.7 | Test setup: choose `bun test` or Vitest after checking Bun compatibility; Supertest for API routes | One passing test per app | Done (`bun test`) |
| 0.7a | Database-backed test setup: `helpdesk_test` database, CI Postgres service, truncation between tests | `bun run test` runs API tests against a real Postgres locally and in CI | Done |
| 0.8 | GitHub Actions CI using `oven-sh/setup-bun`: lint, typecheck, test on every PR | CI runs green on a PR | Done |

## Phase 1 — Data Model and Authentication

| ID | Task | Done when | Status |
|---|---|---|---|
| 1.1 | Prisma setup and initial migration (confirm Prisma works on Bun first) | `bunx prisma migrate dev` runs against local Postgres | Done |
| 1.2 | `User` model: email, name, passwordHash, role (admin/agent), isActive | Migration applied | Done |
| 1.3 | `Session` model: tokenHash, userId, expiresAt, createdAt | Migration applied | Done |
| 1.4 | Password hashing helper: check Bun's built-in password hashing before adding argon2 or bcrypt | Unit tests for hash and verify | Done |
| 1.5 | Seed script creating the first admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Running seed twice creates one admin | Done |
| 1.6 | `POST /api/auth/login` — verify password, create session, set cookie | Test: correct password sets cookie; wrong password returns 401 | Done |
| 1.7 | Auth middleware — hash cookie token, load session and user, reject missing/expired/inactive | Tests for each rejection case | Done |
| 1.8 | `requireAdmin` middleware | Agent gets 403 on an admin route | Done |
| 1.9 | `POST /api/auth/logout` and `GET /api/auth/me` | Tests pass; logout deletes the session row | Done |
| 1.10 | CORS config for the frontend origin with credentials | Browser request from the web app carries the cookie locally | Done |
| 1.11 | Frontend: API client (`credentials: 'include'`), TanStack Query, React Router | App routes render | Done |
| 1.12 | Frontend: login page | Admin can log in with seeded credentials | Done |
| 1.12a | Adopt react-hook-form with zod for forms, converting the login page | An invalid email shows a field-level message before the request is sent | Done |
| 1.13 | Frontend: auth state from `/api/auth/me`, protected routes, logout | Logged-out user is redirected to `/login` | Done |
| 1.14 | Frontend: app layout with navigation; admin-only links hidden for agents | Agent does not see User Management link | Done |

## Phase 2 — User Management (Admin)

| ID | Task | Done when | Status |
|---|---|---|---|
| 2.1 | `GET /api/users` — list users (admin only) | Test passes | Done |
| 2.2 | `POST /api/users` — create agent with email, name, initial password (admin only) | Test passes; duplicate email rejected | Done |
| 2.3 | `PATCH /api/users/:id` — deactivate/reactivate; deactivation deletes the user's sessions | Deactivated agent's next request returns 401 | Done |
| 2.3a | Adopt axios for API calls, converting `apiFetch`; TanStack Query keeps server state | Web and end-to-end suites pass against the axios client | Done |
| 2.4 | Frontend: users list page | Admin sees all users | Done |
| 2.5 | Frontend: create agent form | Admin creates an agent who can then log in | Done |
| 2.6 | Frontend: deactivate/reactivate action | Deactivated agent is logged out | Done |
| 2.7 | Phase 2 security review fixes (#144): stray sessions on reactivation, protected seeded admin, email cap, production write limit on `/api/users`, cache cleared at login | Each fix has a test that fails without it | Done |
| 2.8 | Edit users from a pencil in the Actions column: name, email, password, and deactivate/reactivate; only the seeded admin may change other admins | Every cell of the permission table tested; an agent signs in with the email and password an admin set, and their old session is gone | Done |

## Phase 3 — Tickets (Manual, No Email or AI Yet)

| ID | Task | Done when | Status |
|---|---|---|---|
| 3.1 | `Ticket` model: subject, studentEmail, studentName, status (open/resolved/closed), category (general/technical/refund, nullable), summary (nullable), needsAgent (boolean), escalationReason (refund_approval/ai_failed, nullable), autoCloseAt (nullable), timestamps | Migration applied | Done |
| 3.2 | `Message` model: ticketId, direction (inbound/outbound), author (student/ai/agent), agentId (nullable), body, emailMessageId, createdAt | Migration applied | Done |
| 3.3 | Dev seed script creating sample tickets and messages | Seeded data visible in database | Done |
| 3.4 | `GET /api/tickets` — filter by status and category, sort by created/updated, pagination | Tests for each filter and sort | Done |
| 3.5 | `GET /api/tickets/:id` — ticket with messages | Test passes | Done |
| 3.6 | `PATCH /api/tickets/:id` — agent changes status, category, and clears `needsAgent` | Test passes; invalid values rejected | Done |
| 3.6a | Status transition helper used everywhere: setting Resolved sets `autoCloseAt` = now + 14 days; any other status clears it | Unit tests for each transition | Done |
| 3.7 | `POST /api/tickets/:id/replies` — agent reply saved as outbound message (sending added in Phase 4) | Test passes | Done |
| 3.8 | Frontend: ticket list with filters and sorting | Filters and sort update the list | Done |
| 3.9 | Frontend: ticket detail with message thread | Thread shows student, AI, and agent messages distinctly | Done |
| 3.10 | Frontend: status and category controls on detail page | Changes persist after reload |Done |
| 3.11 | Frontend: agent reply box | Reply appears in the thread |Done |
| 3.12 | `Ticket.assigneeId`: nullable relation to `User`, `onDelete: SetNull`, indexed | Migration applied | Done |
| 3.13 | `PATCH /api/tickets/:id` accepts `assigneeId` (a user id or `null`), refusing an unknown or deactivated user; list and detail return the assignee's id and name | Tests for assign, reassign, clear, unknown user, deactivated user | Done |
| 3.13a | Lock the user row while assigning: the active-user check and the ticket update in one transaction, `SELECT ... FOR UPDATE` | Test drives the interleaving | Done |
| 3.14 | Deactivating a user clears their assignments in the same transaction | A deactivated agent's tickets come back unassigned | Done |
| 3.15 | `GET /api/tickets?assignee=me\|none` filter | Tests for each value, alone and with status and category | Done |
| 3.16 | Frontend: assignee select and **Assign to me** on the ticket detail page | Assignment persists after reload | Done |
| 3.17 | Frontend: Assignee column and filter on the ticket list | Filter narrows the list and lives in the URL | Done |
| 3.18 | End-to-end specs for ticket assignment | `bun run test:e2e` covers assigning, handing over and deactivation | Done |

## Phase 4 — Email

| ID | Task | Done when | Status |
|---|---|---|---|
| 4.1 | Resend account, sending domain DNS records, receiving MX record on a subdomain | Resend shows sending and receiving verified | Done |
| 4.2 | Outbound email service wrapping the Resend SDK, sets `In-Reply-To` and `References` | Test email received in a real inbox, threaded | Done |
| 4.3 | Send agent replies (3.7) by email | Student inbox receives agent reply in the same thread | Done |
| 4.4 | `POST /api/webhooks/resend` with webhook signature verification (per Resend docs) | Unsigned or tampered request returns 401 | Done |
| 4.5 | Parse inbound email per Resend receiving docs: sender, subject, text body, Message-ID, In-Reply-To | Unit tests with saved Resend payloads | Done |
| 4.5a | Bound what inbound email writes, applied where it creates or updates a ticket (#203). From the Phase 3 security review (#164): the columns are unbounded `TEXT`, and nothing could write them until this webhook; the message text is unbounded too. Refuse only an unusable sender (malformed or over 254). Cut the rest down so no student message is dropped over something cosmetic: `subject` over 200 ends in "…", empty is "(no subject)"; `studentName` over 100 or empty is stored as none; message text over 20,000 keeps its beginning then "[Message shortened]", empty is "(This email had no plain-text content.)" | Every field refused or cut down before the insert, with a test per field, message text included | Done |
| 4.6 | Ignore duplicates by Message-ID | Same payload posted twice creates one message | Done |
| 4.7 | Ignore auto-replies and bounces (`Auto-Submitted`, `X-Autoreply`, mailer-daemon senders) | Out-of-office payload creates nothing | Done |
| 4.8 | Threading: match `In-Reply-To`/`References` to an existing ticket, else create a new ticket | Student reply appends to the original ticket | Done |
| 4.9 | Reply to a Resolved or Closed ticket: add the message, keep the status; on Resolved, reset `autoCloseAt` to now + 14 days | Tests: status unchanged; timer reset only on Resolved | Done |
| 4.10 | End-to-end local test using a tunnel to the local API | Real email creates a ticket visible in the UI | Done |

## Phase 5 — AI Pipeline

| ID | Task | Done when | Status |
|---|---|---|---|
| 5.1 | pg-boss setup, started inside the API process | API processes a test job | Done |
| 5.2 | Webhook queues a `process-ticket` job after saving an inbound message | Job appears for each new inbound email | Done |
| 5.2a | Check the sender is authentic before appending a reply to a ticket (#216). From the Phase 4 security review (#210, finding 3): inbound DMARC is not checked, so someone copied on a thread can forge the student's `From:` and add text to their ticket, which from here on the AI reads as the student's words. Read the `Authentication-Results` header Resend passes through, and append only on a DMARC pass; anything else (fail, none, no header) opens a new ticket | Test: a reply with the ticket's IDs and a DMARC fail opens a new ticket; a DMARC pass appends | Done |
| 5.2b | Cap how many tickets one sender can open per time window (#217): 4 per rolling hour. From the Phase 4 security review (#210, finding 5): nothing limits inbound volume, and from here on each email costs an Anthropic call as well as a Resend one. Keyed on the sender address inside ingest, not an IP limit on the webhook: every legitimate webhook call comes from Resend's own servers | Test: past the cap, a sender's new email is acknowledged and opens no ticket; replies to existing tickets still append | Done |
| 5.3 | Define the organization the knowledge base describes: courses, learning platform, account and login help, refund policy | One-page brief agreed | Done |
| 5.4 | Write knowledge base articles with Claude Code from the brief (general, technical, refund topics) | Articles cover every category | Done |
| 5.5 | Knowledge base folder of markdown files and loader | Loader returns combined content; test with sample files | Done |
| 5.6 | Anthropic client, API key from env. Pinned to `claude-haiku-4-5` rather than the `claude-opus-5` first written here: measured on this knowledge base, Haiku answers in ~2.9s at ~$2.23 per thousand tickets against ~5.2s and ~$15.36 for Opus | Test call succeeds | Done |
| 5.7 | Zod schema for AI output: category, summary, reply | Schema shared from `packages/shared` |Done |
| 5.8 | Prompt: knowledge base in cached system prompt, ticket thread as user message, structured JSON output | Returns valid output for sample emails |Done |
| 5.9 | Handle refusals and invalid output (check `stop_reason`, validate with Zod) | Tests for each failure path |Done |
| 5.10 | Save category and summary on the ticket | Values shown on ticket detail |Done |
| 5.11 | Refund safeguard: keyword check on email and draft forces refund handling | Test: "technical question, refund me" is routed to an agent |Done |
| 5.12 | `ReplyDraft` model: ticketId, body, status (pending/approved/rejected), reviewedBy, reviewedAt | Migration applied |Done |
| 5.13 | Routing: general/technical → send reply as AI outbound message and set status Resolved; refund → save pending draft, set `needsAgent` with reason `refund_approval` | Tests for both paths |Done |
| 5.14 | Follow-ups on Resolved or Closed tickets: same routing (reply or refund draft) and category/summary update, but status never changes | Tests: reply sent, summary updated, status unchanged |Done |
| 5.15 | Job retries; after final failure set `needsAgent` with reason `ai_failed`, status stays Open | Test: failing AI call escalates the ticket |Done |
| 5.16 | `POST /api/tasks/auto-close` (shared-secret protected): Resolved tickets with `autoCloseAt` in the past become Closed | Test with an expired and a non-expired Resolved ticket |Done |
| 5.16a | `POST /api/tasks/cleanup-sessions` (shared-secret protected): delete expired sessions | Test passes | Done |
| 5.17 | Log token usage and prompt-cache hits per job | Usage visible in logs | Done |
| 5.18 | Evaluation set: 20–30 sample emails written from the knowledge base brief, with expected category; script reports accuracy | Script runs and reports a score | Done |
| 5.19 | Align the prompt's categories and the refund safeguard with the brief (#237), from the 5.18 baseline of 23/28: logins go general, downloads technical, and partial money back ("send me the difference") is a refund | Test: the safeguard routes "charged the full price, send me the difference" to an agent; `ai:eval` beats 23/28 with no refund sample missed | Done |
| 5.20 | Phase 5 security review fixes (#239): the AI emails only a sender whose first email passed DMARC, marks its email `Auto-Submitted`, stops after 3 AI emails per ticket a day and 50 an hour overall, skips the model past 5 calls per ticket a day and 500 overall, reads at most 40,000 characters of thread, never answers a ticket with a refund draft waiting, sends any reply naming a sum of money to an agent, and logs failures without their message | Each fix has a test that fails without it | Done |

## Phase 6 — Agent Review of AI Output

| ID | Task | Done when | Status |
|---|---|---|---|
| 6.1 | `GET /api/drafts?status=pending` | Test passes | Done |
| 6.2 | `POST /api/drafts/:id/approve` — optional edited body; sends email; records reviewer | Student receives approved reply | Done |
| 6.3 | `POST /api/drafts/:id/reject` | Draft marked rejected; ticket stays Open | Done |
| 6.4 | `GET /api/tickets?needsAgent=true` filter | Test passes | Done |
| 6.5 | Frontend: AI summary and category badge on ticket detail | Visible for AI-processed tickets | Done |
| 6.6 | Frontend: draft review panel — edit, approve, reject | Agent approves an edited draft | Done |
| 6.7 | Frontend: "Needs agent" filter and escalation reason badge on ticket list | Filter shows refund approvals and AI failures | Done |
| 6.8 | Frontend: label AI-sent messages in the thread | AI messages visually distinct from agent messages | Done |
| 6.9 | From the Phase 5 security review (#239), done in #250: the AI does not answer a ticket an agent is working, or one already escalated `ai_failed`; its reply waits as a draft | Test: a follow-up on an assigned or `ai_failed` ticket is drafted, not emailed | Done |
| 6.10 | From the Phase 5 security review (#239), done in #250: two jobs for one ticket cannot both email the student, e.g. a pg-boss `singletonKey` per ticket | Test: two messages queued together produce one AI email | Done |
| 6.11 | From the Phase 5 security review (#239), done in #250: a partial unique index enforces one pending `ReplyDraft` per ticket, so two overlapping jobs cannot each create one | Migration applied; test: a second pending draft is refused | Done |
| 6.12 | Phase 6 security review fixes (#249): an approval names the draft version it reviewed, so one the AI rewrote is not approved unseen; a failed revert after a refused send still answers 502 and logs both errors; state-changing requests from another origin are refused; an agent's own reply retires the pending AI draft | Each fix has a test that fails without it | Done |
| 6.13 | Phase 6 end-to-end specs (#253): approving an edited draft, rejecting one, a draft the AI rewrote while open, the unverified-sender warning, the Needs agent filter and reason badges, and the AI summary and labels on ticket detail | `bun run test:e2e` covers the six journeys | Done |

## Phase 7 — Dashboard

| ID | Task | Done when | Status |
|---|---|---|---|
| 7.1 | `GET /api/dashboard` — counts by status and category, needs-agent count | Test passes | Done |
| 7.2 | Frontend: dashboard with counts and link to tickets needing an agent | Counts match database | Done |
| 7.3 | Frontend: recent tickets on dashboard | Latest tickets listed with links | Done |
| 7.4 | Phase 7 security review fix (#258): the API stops sending `X-Powered-By` and sends `X-Content-Type-Options: nosniff` on every response | A test fails without it | Done |
| 7.5 | Phase 7 end-to-end specs (#259): sign-in lands on the dashboard, the counts include a spec's own tickets, View tickets needing an agent, Recent tickets and its links, and the specs the new home page broke | `bun run test:e2e` covers the journeys | Done |

## Phase 8 — Deployment

| ID | Task | Done when |
|---|---|---|
| 8.1 | DNS records for `app.helpdesk.mahjoub.io` and `api.helpdesk.mahjoub.io` | Both subdomains resolve |
| 8.2 | Multi-stage Dockerfile for the API based on `oven/bun` | Image builds and runs locally |
| 8.3 | Neon project and production database | API connects to Neon |
| 8.4 | Render web service from the Docker image in GitHub Container Registry, with secrets (database URL, Resend API key, Resend webhook secret, tasks secret, Anthropic key); the admin seeded into Neon from a dev machine, since the image has no Prisma CLI | App starts on Render |
| 8.5 | Custom domain `api.helpdesk.mahjoub.io` on Render, and `trust proxy` for Render's proxy | `https://api.helpdesk.mahjoub.io/api/health` returns 200 |
| 8.6 | Confirm background jobs run on Render | A test job completes in production |
| 8.7 | GitHub Actions backend pipeline: build image, run `prisma migrate deploy` against Neon, deploy to Render through its deploy hook | Merge to `main` deploys the backend |
| 8.8 | Vercel project for `apps/web` on `app.helpdesk.mahjoub.io` with `VITE_API_URL` | App loads on the custom domain |
| 8.9 | Cross-subdomain login test | Login works in Chrome, Safari, and Firefox |
| 8.10 | Point Resend receiving webhook at production | Real email creates a production ticket |
| 8.11 | GitHub Actions scheduled workflow calling the auto-close and session-cleanup endpoints | Workflow run closes an expired Resolved ticket |
| 8.12 | Check Neon's free-tier backup/restore options and test one restore | Restore succeeds |
| 8.13 | Anthropic API key with a monthly spend limit set in the Claude Console | Limit visible in Console |

## Notes

- Test the cross-subdomain cookie (8.9) as early as possible — a throwaway deploy of the Phase 1 login is enough.
- Render's free web service spins down after 15 minutes without traffic and takes about a minute to wake. The Resend webhook wakes it; queued jobs are stored in Postgres and run once it is awake.
