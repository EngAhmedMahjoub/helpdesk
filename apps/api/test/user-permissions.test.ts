import { describe, expect, test } from 'bun:test'
import { type Change, type Party, authorise } from '../src/auth/user-permissions.ts'

const seeded: Party = { id: 'seed', role: 'admin', isProtected: true }
const admin: Party = { id: 'admin', role: 'admin', isProtected: false }
const otherAdmin: Party = { id: 'other-admin', role: 'admin', isProtected: false }
const agent: Party = { id: 'agent', role: 'agent', isProtected: false }

const edit: Change = { editsDetails: true }
const deactivate: Change = { editsDetails: false, isActive: false }
const reactivate: Change = { editsDetails: false, isActive: true }

/** Every cell of the table in user-permissions.ts, as [actor, target, change, expected]. */
const cells: [string, Party, Party, Change, 'allowed' | 403 | 409][] = [
  ['seeded admin edits themselves', seeded, seeded, edit, 'allowed'],
  ['seeded admin deactivates themselves', seeded, seeded, deactivate, 409],
  ['seeded admin edits another admin', seeded, admin, edit, 'allowed'],
  ['seeded admin deactivates another admin', seeded, admin, deactivate, 'allowed'],
  ['seeded admin reactivates another admin', seeded, admin, reactivate, 'allowed'],
  ['seeded admin edits an agent', seeded, agent, edit, 'allowed'],
  ['seeded admin deactivates an agent', seeded, agent, deactivate, 'allowed'],

  ['admin edits themselves', admin, admin, edit, 'allowed'],
  ['admin deactivates themselves', admin, admin, deactivate, 409],
  ['admin edits the seeded admin', admin, seeded, edit, 403],
  ['admin deactivates the seeded admin', admin, seeded, deactivate, 409],
  ['admin edits another admin', admin, otherAdmin, edit, 403],
  ['admin deactivates another admin', admin, otherAdmin, deactivate, 403],
  ['admin reactivates another admin', admin, otherAdmin, reactivate, 403],
  ['admin edits an agent', admin, agent, edit, 'allowed'],
  ['admin deactivates an agent', admin, agent, deactivate, 'allowed'],
  ['admin reactivates an agent', admin, agent, reactivate, 'allowed'],
]

describe('who may change whom', () => {
  for (const [label, actor, target, change, expected] of cells) {
    test(`${label}: ${String(expected)}`, () => {
      const verdict = authorise(actor, target, change)

      if (expected === 'allowed') {
        expect(verdict).toEqual({ allowed: true })
      } else {
        expect(verdict.allowed).toBe(false)
        expect(!verdict.allowed && verdict.status).toBe(expected)
      }
    })
  }
})

describe('what the refusals say', () => {
  test('deactivating yourself names yourself, whoever you are', () => {
    // The seeded admin is both "self" and "protected"; the self message is the
    // one that tells them why.
    expect(authorise(seeded, seeded, deactivate)).toMatchObject({
      error: 'You cannot deactivate your own account',
    })
  })

  test('the seeded admin is refused as protected, not as an admin, to everyone', () => {
    expect(authorise(admin, seeded, deactivate)).toMatchObject({
      error: 'This account cannot be deactivated',
    })
  })

  test('the admin rule says who could do it instead', () => {
    expect(authorise(admin, otherAdmin, edit)).toMatchObject({
      error: 'Only the seeded admin can change another admin',
    })
  })
})
