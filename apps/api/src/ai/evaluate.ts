import type Anthropic from '@anthropic-ai/sdk'
import type { TicketCategory } from '@helpdesk/shared'
import { AiFailure } from './failure.ts'
import { type TicketForPrompt, analyseTicket } from './prompt.ts'
import { decideRouting } from './refund-safeguard.ts'

/** One sample of the evaluation set: a ticket and the category it should get. */
export type EvalCase = {
  label: string
  expected: TicketCategory
  ticket: TicketForPrompt
}

/**
 * How one sample came out. `model` is the model's own category, `routed` the
 * one the ticket ends up with once the refund safeguard has had its say, as
 * the job applies it. Both are scored: the first measures the prompt, the
 * second what a student actually gets. A failed call has neither.
 */
export type EvalResult = {
  label: string
  expected: TicketCategory
  model: TicketCategory | null
  routed: TicketCategory | null
  forcedBy: string[]
  failure: string | null
  usage: { input: number; output: number }
}

/**
 * Runs every sample through the prompt, one call at a time: in parallel, a
 * set this size would meet the rate limit, and a 429 here would score as a
 * miss. A failed call is recorded, not thrown, so one bad answer does not
 * lose the others that were already paid for.
 */
export async function evaluate(
  client: Anthropic,
  knowledgeBase: string,
  cases: EvalCase[],
): Promise<EvalResult[]> {
  const results: EvalResult[] = []
  for (const sample of cases) {
    const base = { label: sample.label, expected: sample.expected }
    try {
      const { output, usage } = await analyseTicket(client, knowledgeBase, sample.ticket)
      // As processTicket builds it: the subject and the student's own messages.
      const decision = decideRouting(output, {
        subject: sample.ticket.subject,
        studentMessages: sample.ticket.messages
          .filter((message) => message.author === 'student')
          .map((message) => message.body),
      })
      results.push({
        ...base,
        model: output.category,
        routed: decision.category,
        forcedBy: decision.forcedBy,
        failure: null,
        usage: { input: usage.input_tokens, output: usage.output_tokens },
      })
    } catch (error) {
      if (!(error instanceof AiFailure)) throw error
      results.push({
        ...base,
        model: null,
        routed: null,
        forcedBy: [],
        failure: error.reason,
        usage: { input: error.usage?.input_tokens ?? 0, output: error.usage?.output_tokens ?? 0 },
      })
    }
  }
  return results
}

/** Correct out of total, with a failed call counted as wrong. */
export type Score = { correct: number; total: number }

export type EvalSummary = {
  model: Score
  routed: Score
  /** The routed score for each expected category, to show where misses fall. */
  byCategory: Record<TicketCategory, Score>
  failed: number
  /** Samples the safeguard overrode, whether it was right to or not. */
  forced: number
  usage: { input: number; output: number }
}

export function summarise(results: EvalResult[]): EvalSummary {
  const score = (pick: (result: EvalResult) => boolean, of = results): Score => ({
    correct: of.filter(pick).length,
    total: of.length,
  })
  const inCategory = (category: TicketCategory) =>
    score(
      (result) => result.routed === category,
      results.filter((result) => result.expected === category),
    )
  return {
    model: score((result) => result.model === result.expected),
    routed: score((result) => result.routed === result.expected),
    byCategory: {
      general: inCategory('general'),
      technical: inCategory('technical'),
      refund: inCategory('refund'),
    },
    failed: results.filter((result) => result.failure !== null).length,
    forced: results.filter((result) => result.forcedBy.length > 0).length,
    usage: results.reduce(
      (sum, result) => ({
        input: sum.input + result.usage.input,
        output: sum.output + result.usage.output,
      }),
      { input: 0, output: 0 },
    ),
  }
}
