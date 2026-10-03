import { describe, expect, test } from 'bun:test'
import Anthropic from '@anthropic-ai/sdk'
import { AiFailure } from '../src/ai/failure.ts'
import { type TicketForPrompt, analyseTicket } from '../src/ai/prompt.ts'
import { message, stubAnthropic, usage } from './ai-stub.ts'

const ticket: TicketForPrompt = {
  subject: 'Videos will not play',
  studentName: 'Tom Okafor',
  studentEmail: 'tom@student.example',
  messages: [{ author: 'student', body: 'Week 2 videos spin forever.', createdAt: new Date() }],
}

const valid = {
  category: 'technical' as const,
  summary: 'Week 2 videos will not load.',
  reply: 'Allow auto-play for the site, then reload the lesson.',
}

/** Runs one analysis against `respond` and returns what it threw. */
async function failureFrom(respond: () => Anthropic.Message | Promise<Anthropic.Message>) {
  const { client } = stubAnthropic(respond)
  try {
    await analyseTicket(client, 'knowledge base', ticket)
  } catch (error) {
    return error
  }
  throw new Error('analyseTicket did not throw')
}

async function aiFailureFrom(respond: () => Anthropic.Message | Promise<Anthropic.Message>) {
  const error = await failureFrom(respond)
  expect(error).toBeInstanceOf(AiFailure)
  return error as AiFailure
}

describe('a stop reason other than end_turn', () => {
  test('a refusal is not retried, since the same ticket is refused again', async () => {
    const failure = await aiFailureFrom(() => message(null, 'refusal'))

    expect(failure.reason).toBe('refusal')
    expect(failure.retryable).toBe(false)
    // Billed all the same, so 5.17 has to be able to count it.
    expect(failure.usage).toEqual(usage)
  })

  test('a refusal written as prose is still a refusal, not invalid JSON', async () => {
    // Why the stop reason is read before the text: parsing this first would
    // report "not JSON" and hide that the model declined.
    const failure = await aiFailureFrom(() => message('I cannot help with that.', 'refusal'))

    expect(failure.reason).toBe('refusal')
  })

  test('an answer cut off at max_tokens is truncated, and not retried', async () => {
    const failure = await aiFailureFrom(() =>
      message('{"category":"technical","summary":"Videos', 'max_tokens'),
    )

    expect(failure.reason).toBe('truncated')
    expect(failure.retryable).toBe(false)
    expect(failure.message).toContain('max_tokens')
  })

  test('a ticket too long for the context window is truncated too', async () => {
    const failure = await aiFailureFrom(() => message(null, 'model_context_window_exceeded'))

    expect(failure.reason).toBe('truncated')
    expect(failure.retryable).toBe(false)
  })

  for (const stopReason of ['tool_use', 'pause_turn', 'stop_sequence'] as const) {
    test(`${stopReason}, which the request never asks for, is an unexpected stop`, async () => {
      const failure = await aiFailureFrom(() => message(JSON.stringify(valid), stopReason))

      expect(failure.reason).toBe('unexpected_stop')
      expect(failure.retryable).toBe(false)
      expect(failure.message).toContain(stopReason)
    })
  }
})

describe('an answer that finished but is not usable', () => {
  const invalid: [string, string | null, string][] = [
    ['no text at all', null, 'no text'],
    ['only whitespace', '  \n ', 'no text'],
    ['prose instead of JSON', 'Here is my answer: technical.', 'not JSON'],
    ['a category that is not ours', JSON.stringify({ ...valid, category: 'billing' }), 'category'],
    ['no reply', JSON.stringify({ category: 'technical', summary: 'Videos.' }), 'reply'],
    ['a blank summary', JSON.stringify({ ...valid, summary: '   ' }), 'summary'],
    // Structured output holds the model to the keys but only describes the
    // categories and the lengths, so the schema catches these two after the fact.
    [
      'a summary over 300 characters',
      JSON.stringify({ ...valid, summary: 'a'.repeat(301) }),
      'summary',
    ],
    ['JSON that is not an object', '["technical"]', '(root)'],
  ]

  for (const [label, text, mentions] of invalid) {
    test(`${label} is invalid output, worth one more try`, async () => {
      const failure = await aiFailureFrom(() => message(text))

      expect(failure.reason).toBe('invalid_output')
      // A second answer can come back valid where the first was not.
      expect(failure.retryable).toBe(true)
      expect(failure.message).toContain(mentions)
      expect(failure.usage).toEqual(usage)
    })
  }

  test('a valid answer passes, trimmed', async () => {
    const { client } = stubAnthropic(() =>
      message(JSON.stringify({ ...valid, summary: '  Week 2 videos will not load.  ' })),
    )

    const { output } = await analyseTicket(client, 'knowledge base', ticket)

    expect(output).toEqual(valid)
  })
})

const headers = new Headers()

describe('an error from Anthropic', () => {
  test('a rate limit is retried later', async () => {
    const cause = new Anthropic.RateLimitError(429, undefined, 'slow down', headers)

    const failure = await aiFailureFrom(() => Promise.reject(cause))

    expect(failure.reason).toBe('rate_limited')
    expect(failure.retryable).toBe(true)
    expect(failure.cause).toBe(cause)
  })

  test('a server error is retried later', async () => {
    const failure = await aiFailureFrom(() =>
      Promise.reject(new Anthropic.InternalServerError(529, undefined, 'overloaded', headers)),
    )

    expect(failure.reason).toBe('unavailable')
    expect(failure.retryable).toBe(true)
  })

  test('a dropped connection is retried, not taken for a rejected request', async () => {
    // APIConnectionError is an APIError too; this is the ordering that matters.
    const failure = await aiFailureFrom(() =>
      Promise.reject(new Anthropic.APIConnectionError({ message: 'socket hang up' })),
    )

    expect(failure.reason).toBe('unavailable')
    expect(failure.retryable).toBe(true)
  })

  test('a timeout is retried', async () => {
    const failure = await aiFailureFrom(() =>
      Promise.reject(new Anthropic.APIConnectionTimeoutError()),
    )

    expect(failure.reason).toBe('unavailable')
    expect(failure.retryable).toBe(true)
  })

  const rejected: [string, InstanceType<typeof Anthropic.APIError>][] = [
    ['a bad key', new Anthropic.AuthenticationError(401, undefined, 'invalid x-api-key', headers)],
    ['a bad request', new Anthropic.BadRequestError(400, undefined, 'invalid request', headers)],
    ['an unknown model', new Anthropic.NotFoundError(404, undefined, 'model not found', headers)],
  ]

  for (const [label, cause] of rejected) {
    test(`${label} is rejected and not retried, since sending it again changes nothing`, async () => {
      const failure = await aiFailureFrom(() => Promise.reject(cause))

      expect(failure.reason).toBe('rejected')
      expect(failure.retryable).toBe(false)
      expect(failure.message).toContain(String(cause.status))
      expect(failure.cause).toBe(cause)
    })
  }

  test('an error that is not from Anthropic surfaces as itself', async () => {
    // A bug here, not a failure of the model: wrapping it would hide it.
    const bug = new TypeError('cannot read properties of undefined')

    const error = await failureFrom(() => Promise.reject(bug))

    expect(error).toBe(bug)
  })
})
