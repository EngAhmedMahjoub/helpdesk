# Git workflow — one branch per issue, released through `dev`

Applies to all code and doc changes in this repository.

`dev` is the integration branch; `main` is what is released and deployed. Work reaches `main` only through a release PR from `dev`, once everything on `dev` is verified. `dev` never deploys — `deploy.yml` runs only after CI on `main`.

1. **Start from an issue.** Every change maps to a GitHub issue in `EngAhmedMahjoub/helpdesk`. If no issue exists, ask before creating one.
2. **Create a branch linked to the issue**, based on the latest `dev`. Name it `<issue-number>-<short-slug>` (e.g. `4-docker-compose-postgres`).
3. **Commit on that branch only.** Never commit directly to `dev` or `main`.
4. **Open a pull request** into `dev`. The PR body says `Part of #<issue-number>`, not `Closes`: GitHub only acts on closing keywords in PRs merged into the default branch, so a `Closes` into `dev` does nothing.
5. **Release** with one PR from `dev` into `main`. Its body lists `Closes #<n>` for every issue in the release, and the version's section from `CHANGELOG.md`. Bump the version and write that section on an issue branch into `dev` before opening it.
6. **Close on merge.** Do not close issues manually; merging the release PR closes them and the project marks them Done.
7. **Move the issue to In Progress** on the project board when work on its branch starts.

Before opening a PR, check the issue's *Done when* criteria and report which are verified and which are not.
