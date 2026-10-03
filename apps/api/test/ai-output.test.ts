import { describe, expect, test } from 'bun:test'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import {
  AI_SUMMARY_MAX_LENGTH,
  REPLY_MAX_LENGTH,
  TICKET_CATEGORIES,
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

// What prompt.ts sends, built the same way (#273). The SDK keeps the shape as
// JSON Schema but turns the enum and the lengths into descriptions, so the
// model is told those limits rather than held to them; parseOutput's safeParse
// is what enforces them (ai-failure.test.ts).
describe('the output format the prompt sends', () => {
  const sent = zodOutputFormat(aiOutputSchema)

  test('is a JSON Schema of the same three fields, all required, and no others', () => {
    expect(sent.type).toBe('json_schema')
    expect(sent.schema).toMatchObject({
      type: 'object',
      required: ['category', 'summary', 'reply'],
      // The one limit beyond the keys the model is actually held to.
      additionalProperties: false,
      properties: {
        category: { type: 'string' },
        summary: { type: 'string' },
        reply: { type: 'string' },
      },
    })
  })

  test('tells the model the categories and the lengths', () => {
    const described = (field: 'category' | 'summary' | 'reply') =>
      (sent.schema.properties as Record<string, { description?: string }>)[field]?.description

    for (const category of TICKET_CATEGORIES) expect(described('category')).toContain(category)
    expect(described('summary')).toContain(`maxLength: ${String(AI_SUMMARY_MAX_LENGTH)}`)
    expect(described('summary')).toContain('minLength: 1')
    expect(described('reply')).toContain(`maxLength: ${String(REPLY_MAX_LENGTH)}`)
    expect(described('reply')).toContain('minLength: 1')
  })
})
