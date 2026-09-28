import { describe, expect, test } from 'bun:test'
import { AI_MODEL, anthropic } from '../src/ai/client.ts'
import { env } from '../src/env.ts'

describe('the Anthropic client', () => {
  test('is built from the key the API booted with', () => {
    // Not the SDK's own environment lookup: env.ts is what refuses to boot
    // without a key, and this proves the client uses what it validated.
    expect(anthropic.apiKey).toBe(env.ANTHROPIC_API_KEY)
  })

  test('names the model the whole pipeline uses', () => {
    // Pinned so classification, summary and reply cannot drift onto different
    // models, which would make the evaluation set in 5.18 measure a mixture.
    expect(AI_MODEL).toBe('claude-haiku-4-5')
  })
})
