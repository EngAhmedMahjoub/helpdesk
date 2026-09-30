import { describe, expect, test } from 'bun:test'
import type { AiOutput } from '@helpdesk/shared'
import { type EvalCase, evaluate, summarise } from '../src/ai/evaluate.ts'
import { samples } from '../eval/samples.ts'
import { message, stubAnthropic } from './ai-stub.ts'

// The live run is billed, so `bun run ai:eval` is by hand only. These run the
// same scoring against a stand-in client, and check the set itself.

const at = new Date('2026-09-01T09:00:00Z')
const sample = (label: string, expected: EvalCase['expected'], body: string): EvalCase => ({
  label,
  expected,
  ticket: {
    subject: 'Help',
    studentName: null,
    studentEmail: 'sam@student.example',
    messages: [{ author: 'student', body, createdAt: at }],
  },
})

/** A client answering each request with the next of `categories`, in order. */
function answeringInTurn(categories: (AiOutput['category'] | 'refuse')[]) {
  let call = 0
  return stubAnthropic(() => {
    const category = categories[call++]
    if (category === 'refuse') return message(null, 'refusal')
    return message(JSON.stringify({ category, summary: 'A summary.', reply: 'A reply.' }))
  })
}

describe('evaluate and summarise', () => {
  test("scores the model's category and the routed one separately", async () => {
    const cases = [
      sample('right', 'general', 'Where is my certificate?'),
      sample('wrong', 'technical', 'Videos will not play.'),
      // The model says technical; the safeguard moves it to refund, as expected.
      sample('rescued', 'refund', 'Nothing works, just refund me.'),
    ]
    const { client } = answeringInTurn(['general', 'general', 'technical'])

    const results = await evaluate(client, 'kb', cases)
    const summary = summarise(results)

    expect(results[2]).toMatchObject({ model: 'technical', routed: 'refund' })
    expect(results[2]!.forcedBy.length).toBeGreaterThan(0)
    expect(summary.model).toEqual({ correct: 1, total: 3 })
    expect(summary.routed).toEqual({ correct: 2, total: 3 })
    expect(summary.byCategory).toEqual({
      general: { correct: 1, total: 1 },
      technical: { correct: 0, total: 1 },
      refund: { correct: 1, total: 1 },
    })
    expect(summary.forced).toBe(1)
    // Three calls at the stub's 1,770 in and 110 out.
    expect(summary.usage).toEqual({ input: 3 * 1770, output: 3 * 110 })
  })

  test('records a failed call as wrong and carries on with the rest', async () => {
    const cases = [
      sample('refused', 'general', 'Where is my certificate?'),
      sample('fine', 'general', 'Can I use two coupons?'),
    ]
    const { client } = answeringInTurn(['refuse', 'general'])

    const results = await evaluate(client, 'kb', cases)

    expect(results[0]).toMatchObject({ model: null, routed: null, failure: 'refusal' })
    expect(summarise(results)).toMatchObject({
      routed: { correct: 1, total: 2 },
      failed: 1,
    })
  })

  test('an error that is not a model failure stops the run', async () => {
    // A bug here, not a miss to score.
    const { client } = stubAnthropic(() => {
      throw new TypeError('bug')
    })

    await expect(evaluate(client, 'kb', [sample('x', 'general', 'Hi')])).rejects.toThrow('bug')
  })
})

describe('the evaluation set', () => {
  test('holds 20 to 30 samples with unique labels', () => {
    expect(samples.length).toBeGreaterThanOrEqual(20)
    expect(samples.length).toBeLessThanOrEqual(30)
    expect(new Set(samples.map((s) => s.label)).size).toBe(samples.length)
  })

  test('covers every category', () => {
    const categories = new Set(samples.map((s) => s.expected))
    expect([...categories].sort()).toEqual(['general', 'refund', 'technical'])
  })
})
