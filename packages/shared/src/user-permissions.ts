import type { Role } from './index.ts'

/** The facts about a user that decide who may change them. */
export type Party = {
  id: string
  role: Role
  /** The seeded admin. */
  isProtected: boolean
}

export type Change = {
  /** Name, email or password. */
  editsDetails: boolean
  /** true reactivates, false deactivates, undefined leaves it alone. */
  isActive?: boolean
}

export type Verdict = { allowed: true } | { allowed: false; status: 403 | 409; error: string }

/**
 * Who may change whom, for `PATCH /api/users/:id`. Every caller is already an
 * admin: requireAdmin runs first.
 *
 * Shared so the API and the users page read one table. The API enforces it;
 * the page only uses it to offer the pencil and the Active switch where the API
 * would say yes, so it can never offer something that would be refused.
 *
 * | Acting ↓ / account → | Themselves              | Another admin | Agent |
 * |----------------------|-------------------------|---------------|-------|
 * | Seeded admin         | edit, never deactivate  | anything      | anything |
 * | Any other admin      | edit, never deactivate  | nothing       | anything |
 *
 * And nobody, ever, deactivates the seeded admin.
 *
 * Only the seeded admin may touch another admin's account. Before this rule any
 * admin could deactivate any other, so two of them doing it to each other at
 * the same moment left nobody able to manage users; and an admin who could
 * change another's email or password could lock them out without deactivating
 * them at all. The seeded admin cannot be deactivated, so there is always one
 * account that can put things right.
 *
 * 409 for what nobody may do — it is the account's state that refuses — and
 * 403 for what this caller may not do but another admin could.
 */
export function authorise(actor: Party, target: Party, change: Change): Verdict {
  const self = actor.id === target.id

  if (change.isActive === false) {
    // Checked before the admin rule so these read the same whoever asks.
    if (self) {
      return { allowed: false, status: 409, error: 'You cannot deactivate your own account' }
    }
    if (target.isProtected) {
      return { allowed: false, status: 409, error: 'This account cannot be deactivated' }
    }
  }

  if (target.role === 'admin' && !self && !actor.isProtected) {
    return {
      allowed: false,
      status: 403,
      error: 'Only the seeded admin can change another admin',
    }
  }

  return { allowed: true }
}
