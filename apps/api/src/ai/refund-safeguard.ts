import type { AiOutput, MessageAuthor, TicketCategory } from '@helpdesk/shared'

/**
 * Phrases that mean money back, in the words students actually use. Matched
 * case-insensitively on whole words.
 *
 * Deliberately broad. The costs are lopsided: a false match sends a ticket to
 * an agent who reviews a draft; a miss lets the AI answer a refund request
 * with nobody approving it. So "is the course refundable?" and even "I don't
 * want a refund" are caught: negation is not parsed, because a parser that got
 * it wrong would miss in the expensive direction.
 */
const REFUND_PATTERNS: [label: string, pattern: RegExp][] = [
  // refund, refunds, refunded, refunding, refundable, non-refundable
  ['refund', /\brefund\w*/i],
  ['money back', /\bmoney\s+back\b/i],
  ['chargeback', /\bcharge\s*-?\s*backs?\b/i],
  ['reimburse', /\breimburs\w*/i],
  ['charged twice', /\b(?:charged|billed|paid)\s+twice\b|\bdouble[\s-]*(?:charged|billed)\b/i],
  [
    'cancel purchase',
    /\bcancel\s+(?:my\s+|the\s+)?(?:order|purchase|payment|subscription|enrol+ment)\b/i,
  ],
  ['dispute charge', /\bdispute\s+(?:the\s+|this\s+|a\s+)?(?:charge|payment|transaction)\b/i],
  ['dispute with bank', /\bdispute\s+(?:it|this|that)\s+with\s+(?:my|the)\s+(?:bank|card)\b/i],
  // Partial money back (5.19): the 5.18 evaluation found "charged the full
  // price, send me the difference" answered by the AI, caught by nothing.
  ['overcharged', /\bover[\s-]?(?:charged|billed)\b/i],
  ['charged full price', /\b(?:charged|billed)\s+(?:me\s+)?(?:the\s+)?full\s+price\b/i],
  [
    'the difference back',
    /\b(?:send|give|pay|return|refund)\s+(?:me\s+)?(?:back\s+)?the\s+difference\b|\bdifference\s+back\b/i,
  ],
]

/**
 * A sum of money: a currency sign before a number, or a number before a
 * currency name. The prompt forbids the reply stating an amount, so one there
 * means the model was talked into it or misread the ticket; either way a
 * person should see it before a student holds it in writing (#239).
 */
const AMOUNT = /[$€£]\s?\d|\b\d[\d,.]*\s?(?:usd|eur|gbp|dollars?|euros?|pounds?)\b/i

/** Which refund phrases `text` contains, by label; empty when it contains none. */
export function refundPhrases(text: string): string[] {
  return REFUND_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([label]) => label)
}

/**
 * Who answers the ticket. `agent`: a person approves the drafted reply before
 * it is sent. `auto`: the drafted reply goes out as it is. Acted on by 5.13.
 */
export type Route = 'agent' | 'auto'

export type RoutingDecision = {
  category: TicketCategory
  route: Route
  /**
   * The phrases that overrode the model's category, with where each was found.
   * Empty when the model's own answer stood, which is what 5.17's logging and
   * the evaluation set in 5.18 need to see how often the safeguard steps in.
   */
  forcedBy: string[]
}

/** What the safeguard reads besides the model's answer. */
export type StudentText = {
  subject: string
  /** Every message the student wrote in the thread, not only the newest. */
  studentMessages: string[]
}

/**
 * What the safeguard reads from a ticket: its subject and every message the
 * student wrote, in the order given. One builder for the job and `ai:eval`
 * (#262), so the evaluation scores the safeguard production runs; two copies
 * kept in step by hand could drift, and the score would then measure neither.
 */
export function studentText(ticket: {
  subject: string
  messages: { author: MessageAuthor; body: string }[]
}): StudentText {
  return {
    subject: ticket.subject,
    studentMessages: ticket.messages
      .filter((message) => message.author === 'student')
      .map((message) => message.body),
  }
}

/**
 * The model's category, overridden to refund when the student or the drafted
 * reply talks about money back.
 *
 * The model is told a refund wins over every other category, and in testing
 * it mostly did. This does not depend on "mostly": it is the part of the
 * decision that cannot be talked out of, by a model or by an email written to
 * persuade one.
 *
 * The whole thread is read, so once a ticket has asked for money back its
 * follow-ups stay with agents too. The draft is read as well: a reply that
 * talks about refunds, or names a sum of money, needs approving before it
 * goes out, whatever the model called the ticket.
 */
export function decideRouting(output: AiOutput, student: StudentText): RoutingDecision {
  if (output.category === 'refund') {
    return { category: 'refund', route: 'agent', forcedBy: [] }
  }

  const found = [
    ...refundPhrases(student.subject).map((phrase) => `"${phrase}" in the subject`),
    ...student.studentMessages
      .flatMap((body) => refundPhrases(body))
      .filter((phrase, index, all) => all.indexOf(phrase) === index)
      .map((phrase) => `"${phrase}" in the student's email`),
    ...refundPhrases(output.reply).map((phrase) => `"${phrase}" in the drafted reply`),
    ...(AMOUNT.test(output.reply) ? ['an amount of money in the drafted reply'] : []),
  ]

  if (found.length > 0) return { category: 'refund', route: 'agent', forcedBy: found }
  return { category: output.category, route: 'auto', forcedBy: [] }
}
