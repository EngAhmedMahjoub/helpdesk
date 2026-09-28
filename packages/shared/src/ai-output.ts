import { z } from 'zod'
import { REPLY_MAX_LENGTH, TICKET_CATEGORIES } from './tickets.ts'

/**
 * A summary is one line on the ticket screen, not a second copy of the thread.
 * The cap is what stops a model that ignores "one sentence" from filling the
 * list with a paragraph.
 */
export const AI_SUMMARY_MAX_LENGTH = 300

/**
 * What the model returns for one ticket: where it belongs, what it is about,
 * and what to say back.
 *
 * Shared because three places must agree on it — the prompt sends this shape as
 * its output schema (5.8), the job validates the answer against it before
 * trusting a word (5.9), and the category and summary are written to the ticket
 * (5.10). A drift between any two of those is a bug nothing else would catch.
 *
 * A plain object, not `strictObject`: Zod emits `additionalProperties: false`
 * for both, so the model is constrained either way, but parsing an extra field
 * strips it rather than failing a job over a key nobody reads.
 */
export const aiOutputSchema = z.object({
  category: z.enum(TICKET_CATEGORIES),
  summary: z.string().trim().min(1).max(AI_SUMMARY_MAX_LENGTH),
  // The same ceiling an agent's reply has: both end up as one outbound message,
  // and a limit that differed by author would be arbitrary.
  reply: z.string().trim().min(1).max(REPLY_MAX_LENGTH),
})

export type AiOutput = z.infer<typeof aiOutputSchema>

/**
 * The same shape as JSON Schema, for the model's structured output. Derived
 * rather than written twice, so what the prompt asks for and what the job
 * accepts cannot drift.
 */
export const aiOutputJsonSchema = z.toJSONSchema(aiOutputSchema)
