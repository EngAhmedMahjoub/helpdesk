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
| Knowledge base content | Written with Claude Code as part of Phase 5. |
| Hosting | Free tiers: Vercel (frontend), Koyeb (API + background jobs in one process), Neon (Postgres), Resend (email), GitHub Actions (CI/CD and scheduled tasks). |
| Runtime and package manager | Bun, with Bun workspaces |
| Custom domain | Already owned. Referred to as `<domain>` in these docs. |

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
| 1.13 | Frontend: auth state from `/api/auth/me`, protected routes, logout | Logged-out user is redirected to `/login` |  |
| 1.14 | Frontend: app layout with navigation; admin-only links hidden for agents | Agent does not see User Management link |  |

## Phase 2 — User Management (Admin)

| ID | Task | Done when |
|---|---|---|
| 2.1 | `GET /api/users` — list users (admin only) | Test passes |
| 2.2 | `POST /api/users` — create agent with email, name, initial password (admin only) | Test passes; duplicate email rejected |
| 2.3 | `PATCH /api/users/:id` — deactivate/reactivate; deactivation deletes the user's sessions | Deactivated agent's next request returns 401 |
| 2.4 | Frontend: users list page | Admin sees all users |
| 2.5 | Frontend: create agent form | Admin creates an agent who can then log in |
| 2.6 | Frontend: deactivate/reactivate action | Deactivated agent is logged out |

## Phase 3 — Tickets (Manual, No Email or AI Yet)

| ID | Task | Done when |
|---|---|---|
| 3.1 | `Ticket` model: subject, studentEmail, studentName, status (open/resolved/closed), category (general/technical/refund, nullable), summary (nullable), needsAgent (boolean), escalationReason (refund_approval/ai_failed, nullable), autoCloseAt (nullable), timestamps | Migration applied |
| 3.2 | `Message` model: ticketId, direction (inbound/outbound), author (student/ai/agent), agentId (nullable), body, emailMessageId, createdAt | Migration applied |
| 3.3 | Dev seed script creating sample tickets and messages | Seeded data visible in database |
| 3.4 | `GET /api/tickets` — filter by status and category, sort by created/updated, pagination | Tests for each filter and sort |
| 3.5 | `GET /api/tickets/:id` — ticket with messages | Test passes |
| 3.6 | `PATCH /api/tickets/:id` — agent changes status, category, and clears `needsAgent` | Test passes; invalid values rejected |
| 3.6a | Status transition helper used everywhere: setting Resolved sets `autoCloseAt` = now + 14 days; any other status clears it | Unit tests for each transition |
| 3.7 | `POST /api/tickets/:id/replies` — agent reply saved as outbound message (sending added in Phase 4) | Test passes |
| 3.8 | Frontend: ticket list with filters and sorting | Filters and sort update the list |
| 3.9 | Frontend: ticket detail with message thread | Thread shows student, AI, and agent messages distinctly |
| 3.10 | Frontend: status and category controls on detail page | Changes persist after reload |
| 3.11 | Frontend: agent reply box | Reply appears in the thread |

## Phase 4 — Email

| ID | Task | Done when |
|---|---|---|
| 4.1 | Resend account, sending domain DNS records, receiving MX record on a subdomain | Resend shows sending and receiving verified |
| 4.2 | Outbound email service wrapping the Resend SDK, sets `In-Reply-To` and `References` | Test email received in a real inbox, threaded |
| 4.3 | Send agent replies (3.7) by email | Student inbox receives agent reply in the same thread |
| 4.4 | `POST /api/webhooks/resend` with webhook signature verification (per Resend docs) | Unsigned or tampered request returns 401 |
| 4.5 | Parse inbound email per Resend receiving docs: sender, subject, text body, Message-ID, In-Reply-To | Unit tests with saved Resend payloads |
| 4.6 | Ignore duplicates by Message-ID | Same payload posted twice creates one message |
| 4.7 | Ignore auto-replies and bounces (`Auto-Submitted`, `X-Autoreply`, mailer-daemon senders) | Out-of-office payload creates nothing |
| 4.8 | Threading: match `In-Reply-To`/`References` to an existing ticket, else create a new ticket | Student reply appends to the original ticket |
| 4.9 | Reply to a Resolved or Closed ticket: add the message, keep the status; on Resolved, reset `autoCloseAt` to now + 14 days | Tests: status unchanged; timer reset only on Resolved |
| 4.10 | End-to-end local test using a tunnel to the local API | Real email creates a ticket visible in the UI |

## Phase 5 — AI Pipeline

| ID | Task | Done when |
|---|---|---|
| 5.1 | pg-boss setup, started inside the API process | API processes a test job |
| 5.2 | Webhook queues a `process-ticket` job after saving an inbound message | Job appears for each new inbound email |
| 5.3 | Define the organization the knowledge base describes: courses, learning platform, account and login help, refund policy | One-page brief agreed |
| 5.4 | Write knowledge base articles with Claude Code from the brief (general, technical, refund topics) | Articles cover every category |
| 5.5 | Knowledge base folder of markdown files and loader | Loader returns combined content; test with sample files |
| 5.6 | Anthropic client with `claude-opus-5`, API key from env | Test call succeeds |
| 5.7 | Zod schema for AI output: category, summary, reply | Schema shared from `packages/shared` |
| 5.8 | Prompt: knowledge base in cached system prompt, ticket thread as user message, structured JSON output | Returns valid output for sample emails |
| 5.9 | Handle refusals and invalid output (check `stop_reason`, validate with Zod) | Tests for each failure path |
| 5.10 | Save category and summary on the ticket | Values shown on ticket detail |
| 5.11 | Refund safeguard: keyword check on email and draft forces refund handling | Test: "technical question, refund me" is routed to an agent |
| 5.12 | `ReplyDraft` model: ticketId, body, status (pending/approved/rejected), reviewedBy, reviewedAt | Migration applied |
| 5.13 | Routing: general/technical → send reply as AI outbound message and set status Resolved; refund → save pending draft, set `needsAgent` with reason `refund_approval` | Tests for both paths |
| 5.14 | Follow-ups on Resolved or Closed tickets: same routing (reply or refund draft) and category/summary update, but status never changes | Tests: reply sent, summary updated, status unchanged |
| 5.15 | Job retries; after final failure set `needsAgent` with reason `ai_failed`, status stays Open | Test: failing AI call escalates the ticket |
| 5.16 | `POST /api/tasks/auto-close` (shared-secret protected): Resolved tickets with `autoCloseAt` in the past become Closed | Test with an expired and a non-expired Resolved ticket |
| 5.16a | `POST /api/tasks/cleanup-sessions` (shared-secret protected): delete expired sessions | Test passes |
| 5.17 | Log token usage and prompt-cache hits per job | Usage visible in logs |
| 5.18 | Evaluation set: 20–30 sample emails written from the knowledge base brief, with expected category; script reports accuracy | Script runs and reports a score |

## Phase 6 — Agent Review of AI Output

| ID | Task | Done when |
|---|---|---|
| 6.1 | `GET /api/drafts?status=pending` | Test passes |
| 6.2 | `POST /api/drafts/:id/approve` — optional edited body; sends email; records reviewer | Student receives approved reply |
| 6.3 | `POST /api/drafts/:id/reject` | Draft marked rejected; ticket stays Open |
| 6.4 | `GET /api/tickets?needsAgent=true` filter | Test passes |
| 6.5 | Frontend: AI summary and category badge on ticket detail | Visible for AI-processed tickets |
| 6.6 | Frontend: draft review panel — edit, approve, reject | Agent approves an edited draft |
| 6.7 | Frontend: "Needs agent" filter and escalation reason badge on ticket list | Filter shows refund approvals and AI failures |
| 6.8 | Frontend: label AI-sent messages in the thread | AI messages visually distinct from agent messages |

## Phase 7 — Dashboard

| ID | Task | Done when |
|---|---|---|
| 7.1 | `GET /api/dashboard` — counts by status and category, needs-agent count | Test passes |
| 7.2 | Frontend: dashboard with counts and link to tickets needing an agent | Counts match database |
| 7.3 | Frontend: recent tickets on dashboard | Latest tickets listed with links |

## Phase 8 — Deployment

| ID | Task | Done when |
|---|---|---|
| 8.1 | DNS records for `app.<domain>` and `api.<domain>` | Both subdomains resolve |
| 8.2 | Multi-stage Dockerfile for the API based on `oven/bun` | Image builds and runs locally |
| 8.3 | Neon project and production database | API connects to Neon |
| 8.4 | Koyeb service from the Docker image, with secrets (database URL, Resend API key, Resend webhook secret, tasks secret, Anthropic key, admin seed) | App starts on Koyeb |
| 8.5 | Custom domain `api.<domain>` on Koyeb | `https://api.<domain>/api/health` returns 200 |
| 8.6 | Confirm background jobs run on Koyeb | A test job completes in production |
| 8.7 | GitHub Actions backend pipeline: build image, run `prisma migrate deploy` against Neon, deploy to Koyeb | Merge to `main` deploys the backend |
| 8.8 | Vercel project for `apps/web` on `app.<domain>` with `VITE_API_URL` | App loads on the custom domain |
| 8.9 | Cross-subdomain login test | Login works in Chrome, Safari, and Firefox |
| 8.10 | Point Resend receiving webhook at production | Real email creates a production ticket |
| 8.11 | GitHub Actions scheduled workflow calling the auto-close and session-cleanup endpoints | Workflow run closes an expired Resolved ticket |
| 8.12 | Check Neon's free-tier backup/restore options and test one restore | Restore succeeds |
| 8.13 | Anthropic API key with a monthly spend limit set in the Claude Console | Limit visible in Console |

## Notes

- Test the cross-subdomain cookie (8.9) as early as possible — a throwaway deploy of the Phase 1 login is enough.
- Koyeb's free instance sleeps after 1 hour without traffic. The Resend webhook wakes it; queued jobs are stored in Postgres and run once it is awake.
