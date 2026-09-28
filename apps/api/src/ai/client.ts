import Anthropic from '@anthropic-ai/sdk'
import { env } from '../env.ts'

/**
 * The model every ticket goes through. One constant rather than a parameter:
 * classification, summary and reply are one job, and a model chosen per call
 * would make the evaluation set (5.18) measure a mixture.
 *
 * Haiku for cost and speed. Measured on this knowledge base and three real
 * tickets: ~2.9s and ~$2.23 per thousand tickets, against ~3.7s / $5.02 for
 * Sonnet 5 and ~5.2s / $15.36 for Opus 5. It takes no `effort` parameter and
 * does no adaptive thinking, which is most of why its answers are shorter.
 *
 * What it costs in judgement: on a technical complaint ending "just refund
 * me", Haiku answered `technical` where Opus answered `refund`. The keyword
 * safeguard in 5.11 is what has to catch that, and 5.18's evaluation set is
 * what should say whether this model stays.
 */
export const AI_MODEL = 'claude-haiku-4-5'

/**
 * One client for the process. The SDK holds a connection pool and retries
 * 429s and 5xx itself, so building one per job would throw both away.
 *
 * The key comes from env.ts, which refuses to boot without it, rather than
 * from the SDK's own environment lookup: one place decides what the API needs,
 * and a missing key is a startup failure instead of a job that dies at 3am.
 */
export const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
