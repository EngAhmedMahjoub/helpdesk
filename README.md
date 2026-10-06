# Helpdesk

An AI-powered support desk for Mahjoub Academy, an online programming academy.
The academy is fictional for now: it doesn't exist yet, so its courses,
policies and knowledge base are made up to give the helpdesk something real to
answer. Students email
`support@helpdesk.mahjoub.io`; each email becomes a ticket, Claude classifies it,
summarises it and answers from a knowledge base, and agents and admins work
whatever needs a person: refunds, unverified senders, and anything the AI could
not answer.

- App: https://app.helpdesk.mahjoub.io
- API: https://api.helpdesk.mahjoub.io/api/health

A portfolio project, running on free tiers.

## How it works

1. A student's email reaches Resend, which calls the API's webhook. The API
   checks the signature and the sender's DMARC result, then saves the message as
   a new ticket or a reply on an existing one.
2. A background job (pg-boss, in the API process) asks Claude to classify the
   ticket and draft a reply from the knowledge base in `apps/api/knowledge-base`.
3. The AI emails the reply itself, or holds it as a draft for an agent to
   approve: refunds, senders whose email failed DMARC, tickets an agent is
   already working, and replies past the send limits.
4. Agents see the queue, approve or edit drafts, reply, and change status.
   Resolved tickets close themselves after 14 days.

## Stack

| Piece | Choice | Hosted on |
| --- | --- | --- |
| Web app | React, Vite, TanStack Query, shadcn/ui, Tailwind | Vercel |
| API | Express 5 on Bun, Prisma, pg-boss | Render, from a Docker image in GHCR |
| Database | PostgreSQL 18 | Neon |
| Email | Resend, sending and receiving | |
| AI | Claude, through the Anthropic API | |
| CI/CD and scheduled tasks | GitHub Actions | |

Every decision and the reason for it is in [`tech-stack.md`](tech-stack.md); the
work, phase by phase, is in [`implementation-plan.md`](implementation-plan.md).

## Repository layout

Bun workspaces:

- `apps/api`: the Express API, its Prisma schema and migrations, background jobs, and the knowledge base
- `apps/web`: the React app
- `apps/e2e`: Playwright end-to-end tests
- `packages/shared`: types and validation shared by the API and the web app

## Running it locally

Needs [Bun](https://bun.sh) 1.4.2 and Docker.

```sh
bun install
docker compose up -d --wait          # Postgres 18 on localhost:5432
cp apps/api/.env.example apps/api/.env   # then fill in the keys it asks for
bun --filter '@helpdesk/api' db:generate
bun --filter '@helpdesk/api' db:migrate
bun --filter '@helpdesk/api' db:seed     # the admin, from ADMIN_EMAIL and ADMIN_PASSWORD
bun run dev                          # API on :3000, web app on :5173
```

`apps/api/.env.example` explains every variable. The API refuses to start
without the ones it needs, rather than failing later.

| Command | Runs |
| --- | --- |
| `bun run dev` | API on 3000 and Vite on 5173 |
| `bun run test` | API and web suites (the API's against a real `helpdesk_test` database) |
| `bun run test:e2e` | Playwright, against its own servers and database |
| `bun run typecheck` / `lint` / `format` | All workspaces |

The API tests make no paid calls: they pass stand-ins for the Claude and Resend clients, and `apps/api/.env.test` holds made-up keys that no real call could use.

## Deployment

- **Web app:** Vercel builds and deploys `main` on every push.
- **API:** `.github/workflows/deploy.yml` runs once CI passes on `main`. It
  builds the image and pushes it to GHCR, applies migrations to Neon, then
  deploys that image on Render through its deploy hook.
- **Scheduled tasks:** `.github/workflows/tasks.yml` runs daily, closing
  Resolved tickets past their 14 days and deleting expired sessions.

Pull requests run lint, typecheck, the tests and the format check
(`.github/workflows/ci.yml`).
