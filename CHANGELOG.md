# Changelog

Each release's section is pasted into its release PR from `dev` into `main`.

## 1.1.0 — 2026-10-19

### Security

From the post-MVP security review ([#325](https://github.com/EngAhmedMahjoub/helpdesk/issues/325)):

- Login is also limited per IP alone, and the login password is capped at the same length as create and edit ([#326](https://github.com/EngAhmedMahjoub/helpdesk/issues/326)).
- Polish refuses a rewrite that adds a bare domain, digits in any script, currency words or refund wording ([#327](https://github.com/EngAhmedMahjoub/helpdesk/issues/327)).
- An automatic AI reply carrying a URL, domain or email address outside the knowledge base and the academy's own domain is held as a draft for an agent instead of sent ([#328](https://github.com/EngAhmedMahjoub/helpdesk/issues/328)).
- The web app sends anti-framing headers, and in production the session cookie is `__Host-session` ([#329](https://github.com/EngAhmedMahjoub/helpdesk/issues/329)). The rename signs everyone out once when this deploys.
- Workflow actions are pinned to commit SHAs, with narrower token permissions ([#330](https://github.com/EngAhmedMahjoub/helpdesk/issues/330)).
- The `bun audit` advisories are cleared, including Prisma 7.10.1 ([#331](https://github.com/EngAhmedMahjoub/helpdesk/issues/331)).

### Changed

Behaviour-preserving cleanup from the post-security review ([#339](https://github.com/EngAhmedMahjoub/helpdesk/issues/339)):

- Every rate limiter is built from one base ([#340](https://github.com/EngAhmedMahjoub/helpdesk/issues/340)).
- The child-process and stand-in-app test setup is shared ([#341](https://github.com/EngAhmedMahjoub/helpdesk/issues/341)).
- Model calls go through one checked wrapper; unused Polish and link exports are dropped ([#342](https://github.com/EngAhmedMahjoub/helpdesk/issues/342)).
- The reply body, ticket sort and user-name shapes are each defined once ([#343](https://github.com/EngAhmedMahjoub/helpdesk/issues/343)).
- Tables share one column-header row, and query and form errors use shared alert components ([#344](https://github.com/EngAhmedMahjoub/helpdesk/issues/344)).
- The e2e session cookie comment names its `NODE_ENV` dependency ([#345](https://github.com/EngAhmedMahjoub/helpdesk/issues/345)).

## 1.0.0 — 2026-10-13

The first versioned release, reporting its version and commit from `/api/health` ([#321](https://github.com/EngAhmedMahjoub/helpdesk/pull/321)).
