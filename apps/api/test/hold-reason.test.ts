import { describe, expect, test } from 'bun:test'
import type { EscalationReason } from '@helpdesk/shared'
import { type HoldFacts, holdReason } from '../src/jobs/process-ticket.ts'

/** Nothing holds the answer: a verified sender, unassigned, under the limits. */
const clear: HoldFacts = {
  routedToAgent: false,
  refundWaiting: false,
  senderVerified: true,
  escalationReason: null,
  assigned: false,
  sendLimited: false,
}

/**
 * Each hold, as the facts that trigger it, highest precedence first: the
 * order tech-stack.md "AI limits and holds" documents. process-ticket.test.ts
 * proves each one alone end to end; this proves which wins when several apply.
 */
const holds: [EscalationReason, Partial<HoldFacts>][] = [
  ['refund_approval', { routedToAgent: true }],
  ['unverified_sender', { senderVerified: false }],
  ['ai_failed', { escalationReason: 'ai_failed' }],
  ['agent_assigned', { assigned: true }],
  ['auto_reply_limit', { sendLimited: true }],
]

describe('the hold reason', () => {
  test('is null when nothing holds the answer', () => {
    expect(holdReason(clear)).toBeNull()
  })

  test('is a refund when one already waits, even if this answer is not one', () => {
    expect(holdReason({ ...clear, refundWaiting: true })).toBe('refund_approval')
  })

  for (const [reason, facts] of holds) {
    test(`is ${reason} when only that applies`, () => {
      expect(holdReason({ ...clear, ...facts })).toBe(reason)
    })
  }

  // Every pair, both ways round, so the order cannot change unnoticed.
  for (const [i, [higher, higherFacts]] of holds.entries()) {
    for (const [lower, lowerFacts] of holds.slice(i + 1)) {
      test(`${higher} wins over ${lower}`, () => {
        expect(holdReason({ ...clear, ...lowerFacts, ...higherFacts })).toBe(higher)
      })
    }
  }

  test('is the first in order when every hold applies at once', () => {
    const all = Object.assign({}, clear, ...holds.map(([, facts]) => facts)) as HoldFacts
    expect(holdReason(all)).toBe('refund_approval')
  })

  test('an earlier reason other than ai_failed does not hold the answer by itself', () => {
    expect(holdReason({ ...clear, escalationReason: 'agent_assigned' })).toBeNull()
    expect(holdReason({ ...clear, escalationReason: 'unverified_sender' })).toBeNull()
  })
})
