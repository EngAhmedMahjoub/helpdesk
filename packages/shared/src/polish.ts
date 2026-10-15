import { z } from 'zod'

/**
 * Half a reply's limit. Polishing is billed per call and its answer is about
 * as long as its input, so this bounds what one request can cost; a reply long
 * enough to pass it is better tidied a part at a time anyway.
 */
export const POLISH_MAX_LENGTH = 5_000

/** The body of `POST /api/ai/polish`: the agent's text, to be tidied. */
export const polishRequestSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, 'Write something to polish')
    .max(POLISH_MAX_LENGTH, `Polish at most ${POLISH_MAX_LENGTH} characters at a time`),
})

export type PolishRequest = z.infer<typeof polishRequestSchema>

/** The tidied text. Nothing is sent: the agent reads it and sends it themselves. */
export type PolishResponse = { text: string }
