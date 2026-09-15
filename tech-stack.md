# Tech Stack

## Overview

TypeScript monorepo: React + Vite frontend on Vercel, Node.js + Express API (with in-process background jobs) in Docker on Koyeb, PostgreSQL on Neon, Resend for email, and Claude for AI. All hosting uses free tiers (portfolio project).

## Repository

npm workspaces:

- `apps/web` — frontend
- `apps/api` — API and background jobs
- `packages/shared` — shared types and Zod schemas

## Frontend (`apps/web`)

| Concern | Choice |
|---|---|
| Framework | React + Vite + TypeScript |
| Routing | React Router |
| Data fetching | TanStack Query |
| UI | Tailwind CSS + shadcn/ui |
| API calls | `fetch` with `credentials: 'include'` to `VITE_API_URL` |
| Route protection | Call `GET /api/auth/me` on load; 401 redirects to `/login`; `role` hides admin-only screens |

Hiding screens in the UI is not access control. Express enforces permissions on every endpoint.

## Backend (`apps/api`)

| Concern | Choice |
|---|---|
| Runtime / framework | Node.js + Express + TypeScript |
| Validation | Zod |
| ORM | Prisma |
| Database | PostgreSQL |
| Background jobs | pg-boss, running inside the API process (Koyeb's free instance cannot run a separate worker) |
| Scheduled tasks | GitHub Actions scheduled workflow calls protected endpoints (the API sleeps when idle, so in-process schedules are unreliable) |
| CORS | Allow origin `https://app.<domain>` with `credentials: true` |
| Tests | Vitest + Supertest |

## Authentication

Database sessions.

| Piece | Design |
|---|---|
| Session table | Prisma `Session` model: `id`, `tokenHash`, `userId`, `expiresAt`, `createdAt` |
| Token | 32 random bytes (`crypto.randomBytes`); raw token in the cookie, SHA-256 hash in the database |
| Cookie | `httpOnly`, `Secure`, `SameSite=Lax`, set by `api.<domain>` |
| Passwords | argon2 or bcrypt |
| Expiry | 8 hours; expired sessions deleted by a scheduled task |
| Login | `POST /api/auth/login` creates a session and sets the cookie |
| Logout | `POST /api/auth/logout` deletes the session and clears the cookie |
| Current user | `GET /api/auth/me` returns `{ id, email, role }` or 401 |
| Request middleware | Hash cookie token, load session + user, reject if missing, expired, or user deactivated |
| Deactivating an agent | Mark user inactive and delete all their sessions |
| First admin | Seed script using `ADMIN_EMAIL` / `ADMIN_PASSWORD` |
| Agent creation | `POST /api/users`, admin only |

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
| API + background jobs | Koyeb free instance, Docker image, on `api.<domain>` |
| Database | Neon free Postgres |
| Email | Resend free |
| Scheduled tasks | GitHub Actions scheduled workflow |
| CI/CD | GitHub Actions |

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

Not checked against current documentation:

- Library versions and APIs: Vite, React Router, TanStack Query, Express, Prisma, pg-boss, argon2, Resend SDK.
- Free tier limits for Koyeb, Neon, and Resend on their pricing pages.
- Cross-subdomain session cookie between Vercel and Koyeb — test a real login early.
