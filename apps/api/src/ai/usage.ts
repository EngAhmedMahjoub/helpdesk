import type Anthropic from '@anthropic-ai/sdk'

/**
 * One log line for one model call (5.17): what it cost and what came of it.
 * key=value pairs on one line, so the host's log search can find every call
 * with `AI usage` and pick out a field without a parser.
 *
 * Cache reads are the prompt-cache hits; cache writes are the calls that
 * primed it. Both stay 0 until the system prompt passes Haiku's 4,096-token
 * minimum. The SDK reports them as null when a request marks no cache, so
 * null is logged as 0 rather than left out, keeping every line the same shape.
 *
 * `subject` names what the call was for: `{ ticket }` for the ticket job, or
 * `{ polish_by }` for an agent's Polish (#323), so the two never share a field.
 *
 * Never the ticket's text, the reply or the polished text: an id is enough to
 * find the source, and a log is the wrong place for a student's email.
 */
export function usageLine(
  subject: { ticket: number } | { polish_by: string },
  usage: Anthropic.Usage,
  outcome: string,
): string {
  const fields = {
    ...subject,
    outcome,
    input: usage.input_tokens,
    output: usage.output_tokens,
    cache_read: usage.cache_read_input_tokens ?? 0,
    cache_write: usage.cache_creation_input_tokens ?? 0,
  }
  const pairs = Object.entries(fields).map(([key, value]) => `${key}=${String(value)}`)
  return `AI usage: ${pairs.join(' ')}`
}
