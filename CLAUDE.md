# Helpdesk

AI-powered support desk: student emails become tickets, Claude classifies them and drafts replies, agents and admins work them. Bun workspaces — `apps/api` (Express 5), `apps/web` (React + Vite), `apps/e2e` (Playwright), `packages/shared` (types).

This file is loaded every session, so it routes rather than repeats:

- **`implementation-plan.md`** — the task list by phase, and what is built. Check it before assuming a screen or endpoint exists.
- **`tech-stack.md`** — every technical decision and the reason for it.
- **`.claude/rules/git-workflow.md`** — one issue, one branch, one PR. `main` is protected; a direct push is refused.

## Commands

| Command | Runs |
| --- | --- |
| `bun run dev` | API on 3000 and Vite on 5173 |
| `bun run test` | API and web suites |
| `bun run test:e2e` | Playwright, against its own servers and database |
| `bun run typecheck` / `lint` / `format` | All four workspaces |

`docker compose up -d --wait` first; everything needs Postgres.

## Tests

Three layers, and they do not overlap:

| Layer | Tool | Where |
| --- | --- | --- |
| API routes and middleware | `bun test` + Supertest, against a real `helpdesk_test` database | `apps/api/test` |
| Components and hooks | `bun test` + Testing Library + happy-dom | `apps/web/test` |
| Journeys across the stack | Playwright, real browser and real API | `apps/e2e/tests` |

Do not unit-test shadcn or Tailwind internals. A component that only arranges library parts is verified by the build and by looking at it, not by asserting on class names.

## Subagents

All three are defined in `.claude/agents/` and registered at session start; a newly added one needs a restart.

**`e2e-test-writer` — use it for every Playwright spec.** Do not hand-write specs in `apps/e2e/tests`. It already knows the harness and the traps in it: that `helpdesk_e2e` is prepared once per run rather than per test, so specs must own and clean up what they create and never assert on totals; that ports 3100 and 5273 exist to keep a run away from the development servers and their data; and which phases are unbuilt, so it will not write specs for placeholder screens. Give it the journey to cover, not the mechanics.

**`security-reviewer` — use it before merging anything touching auth**, the Resend webhook, the task endpoints, or code reaching the database or the Anthropic API. Read-only. It marks each finding Confirmed or Suspected and says what it could not trace.

**`code-cleanup-reviewer` — use it when asked to review code for duplication, modularity or readability.** Read-only; it suggests behaviour-preserving refactors ranked by payoff and risk, names the tests that cover each one, and knows which odd-looking choices are deliberate so it does not "clean" them away.

## Conventions

Comments explain *why*, not *what* — the trade-off taken, the failure that prompted the line. Prettier: no semicolons, single quotes, 100 columns.

**Data fetching: axios for the HTTP call, TanStack Query for server state.** Never native `fetch`. Go through `apiRequest` (or `apiClient`) in `apps/web/src/lib/api.ts` — it carries the base URL, `withCredentials`, and the interceptor that turns a failure into `ApiError`. Caching, invalidation and loading state belong to `useQuery` / `useMutation`, not to hand-rolled state.

Verify before reporting. Run the thing and read the output; a change that looks right is not a change that works. When a check is skipped or a claim rests on inference, say so.
