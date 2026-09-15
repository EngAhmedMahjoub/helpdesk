# Git workflow — one branch per issue

Applies to all code and doc changes in this repository.

1. **Start from an issue.** Every change maps to a GitHub issue in `EngAhmedMahjoub/helpdesk`. If no issue exists, ask before creating one.
2. **Create a branch linked to the issue**, based on the latest `main`. Name it `<issue-number>-<short-slug>` (e.g. `4-docker-compose-postgres`).
3. **Commit on that branch only.** Never commit directly to `main`.
4. **Open a pull request** into `main`. The PR body includes `Closes #<issue-number>` so the issue closes when the PR merges.
5. **Close on merge.** Do not close issues manually; merging the PR closes the issue and the project marks it Done.
6. **Move the issue to In Progress** on the project board when work on its branch starts.

Before opening the PR, check the issue's *Done when* criteria and report which are verified and which are not.
