import Anthropic from '@anthropic-ai/sdk'
import { env } from '../env.ts'

/**
 * The model every ticket goes through. One constant rather than a parameter:
 * classification, summary and reply are one job, and a cheaper model chosen per
 * call would make the evaluation set (5.18) measure a mixture.
 */
export const AI_MODEL = 'claude-opus-5'

/**
 * How hard the model works on a ticket. Classifying a support email and
 * drafting a reply from the knowledge base is routine work, and low effort
 * keeps the per-ticket cost down on a free-tier budget; 5.18's evaluation set
 * is what should decide whether it needs raising.
 */
export const AI_EFFORT = 'low'

/**
 * One client for the process. The SDK holds a connection pool and retries
 * 429s and 5xx itself, so building one per job would throw both away.
 *
 * The key comes from env.ts, which refuses to boot without it, rather than
 * from the SDK's own environment lookup: one place decides what the API needs,
 * and a missing key is a startup failure instead of a job that dies at 3am.
 */
export const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
