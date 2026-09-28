import { describe, expect, test } from 'bun:test'
import {
  AI_SUMMARY_MAX_LENGTH,
  REPLY_MAX_LENGTH,
  TICKET_CATEGORIES,
  aiOutputJsonSchema,
  aiOutputSchema,
} from '@helpdesk/shared'

const valid = {
  category: 'technical' as const,
  summary: 'Videos will not play in Safari.',
  reply: 'Allow auto-play for the site in Safari settings, then reload the lesson.',
}

describe('the AI output schema', () => {
  test('accepts an answer of the shape the prompt asks for', () => {
    expect(aiOutputSchema.parse(valid)).toEqual(valid)
  })

  test('accepts every category a ticket can have', () => {
    for (const category of TICKET_CATEGORIES) {
      expect(aiOutputSchema.safeParse({ ...valid, category }).success).toBe(true)
    }
  })

  test('refuses a category that is not one of ours', () => {
    // A model that invents "billing" must not write it to the ticket, where
    // the column is an enum and the insert would fail far from here.
    expect(aiOutputSchema.safeParse({ ...valid, category: 'billing' }).success).toBe(false)
  })

  const missing: [string, Record<string, unknown>][] = [
    ['category', { summary: valid.summary, reply: valid.reply }],
    ['summary', { category: valid.category, reply: valid.reply }],
    ['reply', { category: valid.category, summary: valid.summary }],
  ]

  for (const [field, answer] of missing) {
    test(`refuses an answer with no ${field}`, () => {
      expect(aiOutputSchema.safeParse(answer).success).toBe(false)
    })
  }

  test('refuses an empty or whitespace-only summary or reply', () => {
    for (const blank of ['', '   \n ']) {
      expect(aiOutputSchema.safeParse({ ...valid, summary: blank }).success).toBe(false)
      expect(aiOutputSchema.safeParse({ ...valid, reply: blank }).success).toBe(false)
    }
  })

  test('trims what it accepts, so no message starts with the model spacing', () => {
    const parsed = aiOutputSchema.parse({
      ...valid,
      summary: '  Videos will not play.  ',
      reply: '\n\nTry Safari settings.\n',
    })

    expect(parsed.summary).toBe('Videos will not play.')
    expect(parsed.reply).toBe('Try Safari settings.')
  })

  test('caps the summary, which is one line on a list, and the reply', () => {
    expect(
      aiOutputSchema.safeParse({ ...valid, summary: 'a'.repeat(AI_SUMMARY_MAX_LENGTH) }).success,
    ).toBe(true)
    expect(
      aiOutputSchema.safeParse({ ...valid, summary: 'a'.repeat(AI_SUMMARY_MAX_LENGTH + 1) })
        .success,
    ).toBe(false)
    expect(
      aiOutputSchema.safeParse({ ...valid, reply: 'a'.repeat(REPLY_MAX_LENGTH + 1) }).success,
    ).toBe(false)
  })

  test('refuses a field of the wrong type rather than coercing it', () => {
    expect(aiOutputSchema.safeParse({ ...valid, summary: 42 }).success).toBe(false)
    expect(aiOutputSchema.safeParse({ ...valid, reply: { text: 'hello' } }).success).toBe(false)
  })

  test('strips a field nobody asked for instead of failing the job', () => {
    const parsed = aiOutputSchema.parse({ ...valid, confidence: 0.9 })

    expect(parsed).toEqual(valid)
    expect('confidence' in parsed).toBe(false)
  })
})

describe('the JSON Schema the prompt sends', () => {
  test('describes the same three fields, all required', () => {
    expect(aiOutputJsonSchema).toMatchObject({
      type: 'object',
      required: ['category', 'summary', 'reply'],
      // Constrains the model to exactly these keys.
      additionalProperties: false,
    })
  })

  test('carries the categories and the lengths, so the model is told the limits', () => {
    expect(aiOutputJsonSchema).toMatchObject({
      properties: {
        category: { enum: [...TICKET_CATEGORIES] },
        summary: { type: 'string', minLength: 1, maxLength: AI_SUMMARY_MAX_LENGTH },
        reply: { type: 'string', minLength: 1, maxLength: REPLY_MAX_LENGTH },
      },
    })
  })
})
