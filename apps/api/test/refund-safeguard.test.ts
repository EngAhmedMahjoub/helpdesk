import { describe, expect, test } from 'bun:test'
import type { AiOutput } from '@helpdesk/shared'
import { decideRouting, refundPhrases, studentText } from '../src/ai/refund-safeguard.ts'

describe('refund phrases', () => {
  const caught: [string, string][] = [
    ['Honestly, just refund me.', 'refund'],
    ['Can I get a REFUND?', 'refund'],
    ['I was never refunded.', 'refund'],
    ['Is the bootcamp refundable?', 'refund'],
    ['I want my money back.', 'money back'],
    ['I will file a chargeback with my bank.', 'chargeback'],
    ['I will do a charge-back.', 'chargeback'],
    ['Please reimburse me.', 'reimburse'],
    ['I expect reimbursement.', 'reimburse'],
    ['My card was charged twice.', 'charged twice'],
    ['I think I was double-charged.', 'charged twice'],
    ['I paid twice for the same course.', 'charged twice'],
    ['Please cancel my purchase.', 'cancel purchase'],
    ['I want to cancel my enrollment.', 'cancel purchase'],
    ['I will dispute the charge.', 'dispute charge'],
    ['If not sorted I will dispute it with my bank.', 'dispute with bank'],
    ['I think I was overcharged.', 'overcharged'],
    ['I was over-billed for the course.', 'overcharged'],
    ['The coupon was accepted but I was charged the full price.', 'charged full price'],
    ['Please send me the difference.', 'the difference back'],
    ['Can I have the difference back?', 'the difference back'],
  ]

  for (const [text, phrase] of caught) {
    test(`catches "${text}"`, () => {
      expect(refundPhrases(text)).toContain(phrase)
    })
  }

  test('catches a refund even when the student says they do not want one', () => {
    // On purpose: parsing negation wrong would miss in the expensive direction.
    expect(refundPhrases("I don't want a refund, just working videos.")).toEqual(['refund'])
  })

  const ignored = [
    'My videos will not play in Safari.',
    'I was charged the student price, thanks.',
    'Can I cancel the meeting on Friday?',
    'The fundamentals module is great.',
    'Can I get back into my account?',
    'Please send the certificate back to me with my name fixed.',
    'What is the difference between the two courses?',
    'Is the full price shown in dollars?',
  ]

  for (const text of ignored) {
    test(`leaves "${text}" alone`, () => {
      expect(refundPhrases(text)).toEqual([])
    })
  }
})

const reply = 'Allow auto-play for the site, then reload the lesson.'
const technical: AiOutput = { category: 'technical', summary: 'Videos will not load.', reply }

describe('the routing decision', () => {
  describe('a sum of money in the drafted reply (#239)', () => {
    // Injection plus a misread ticket could produce a promise of money with no
    // refund word in it; the prompt forbids amounts, so any is a warning sign.
    const promising = [
      'Your $49 payment will be returned to your card within 5 days.',
      'We will send €20 back to you.',
      'A credit of £ 15 has been applied.',
      'You will receive 49 USD shortly.',
      'We are returning 30 dollars to your account.',
    ]

    for (const draft of promising) {
      test(`routes "${draft}" to an agent`, () => {
        const decision = decideRouting(
          { ...technical, reply: draft },
          { subject: 'Videos', studentMessages: ['The videos will not play.'] },
        )

        expect(decision).toMatchObject({ route: 'agent', category: 'refund' })
        expect(decision.forcedBy).toContain('an amount of money in the drafted reply')
      })
    }

    test('lets a reply with ordinary numbers go out', () => {
      const decision = decideRouting(
        {
          ...technical,
          reply: 'Try Chrome 120 or later, and wait 10 minutes for the reset email.',
        },
        { subject: 'Videos', studentMessages: ['The videos will not play.'] },
      )

      expect(decision.route).toBe('auto')
    })
  })

  test('"charged the full price, send me the difference" is routed to an agent', () => {
    // The done-when for 5.19: the one refund sample the 5.18 evaluation found
    // the model filing as general, and no phrase catching.
    const general: AiOutput = { category: 'general', summary: 'Coupon did not apply.', reply }
    const decision = decideRouting(general, {
      subject: 'Coupon did not apply',
      studentMessages: [
        'My 20% coupon was accepted but I was charged the full price. Please send me the difference.',
      ],
    })

    expect(decision.route).toBe('agent')
    expect(decision.category).toBe('refund')
    expect(decision.forcedBy.length).toBeGreaterThan(0)
  })

  test('"technical question, refund me" is routed to an agent', () => {
    // The done-when for 5.11, and the trap Haiku missed in the model benchmark.
    const decision = decideRouting(technical, {
      subject: 'Videos will not play',
      studentMessages: ['None of the videos play on Chrome either. Honestly, just refund me.'],
    })

    expect(decision).toEqual({
      category: 'refund',
      route: 'agent',
      forcedBy: [`"refund" in the student's email`],
    })
  })

  test('a refund the model already saw goes to an agent, with nothing forced', () => {
    const decision = decideRouting(
      { ...technical, category: 'refund' },
      { subject: 'Refund', studentMessages: ['Refund please.'] },
    )

    expect(decision).toEqual({ category: 'refund', route: 'agent', forcedBy: [] })
  })

  test('a plain technical question is answered automatically', () => {
    const decision = decideRouting(technical, {
      subject: 'Videos',
      studentMessages: ['Week 2 videos spin forever on Safari.'],
    })

    expect(decision).toEqual({ category: 'technical', route: 'auto', forcedBy: [] })
  })

  test('a general question keeps its category', () => {
    const decision = decideRouting(
      { ...technical, category: 'general' },
      { subject: 'Certificate', studentMessages: ['My name is misspelled on my certificate.'] },
    )

    expect(decision).toEqual({ category: 'general', route: 'auto', forcedBy: [] })
  })

  test('the subject alone is enough', () => {
    const decision = decideRouting(technical, {
      subject: 'Refund request',
      studentMessages: ['The videos do not work.'],
    })

    expect(decision.route).toBe('agent')
    expect(decision.forcedBy).toEqual([`"refund" in the subject`])
  })

  test('an earlier message in the thread keeps a follow-up with agents', () => {
    const decision = decideRouting(technical, {
      subject: 'Videos',
      studentMessages: ['I want my money back.', 'Also, week 3 will not load now.'],
    })

    expect(decision.category).toBe('refund')
    expect(decision.forcedBy).toEqual([`"money back" in the student's email`])
  })

  test('a draft that talks about refunds needs approving, whatever the category', () => {
    const decision = decideRouting(
      { ...technical, reply: 'We have issued you a full refund.' },
      { subject: 'Videos', studentMessages: ['The videos do not load.'] },
    )

    expect(decision).toEqual({
      category: 'refund',
      route: 'agent',
      forcedBy: [`"refund" in the drafted reply`],
    })
  })

  test('names each phrase once, and where it was found', () => {
    const decision = decideRouting(technical, {
      subject: 'Refund',
      studentMessages: ['Refund me.', 'I said refund me, and give my money back.'],
    })

    expect(decision.forcedBy).toEqual([
      `"refund" in the subject`,
      `"refund" in the student's email`,
      `"money back" in the student's email`,
    ])
  })
})

// One builder for the job and ai:eval (#262).
describe('the student text', () => {
  test("keeps the subject and only the student's messages, in order", () => {
    expect(
      studentText({
        subject: 'Cannot log in',
        messages: [
          { author: 'student', body: 'First' },
          { author: 'ai', body: 'Have you tried resetting it?' },
          { author: 'agent', body: 'Refunds are handled by finance' },
          { author: 'student', body: 'Second' },
        ],
      }),
    ).toEqual({ subject: 'Cannot log in', studentMessages: ['First', 'Second'] })
  })
})
