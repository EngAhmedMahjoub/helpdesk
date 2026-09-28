import type Anthropic from '@anthropic-ai/sdk'

/**
 * A stand-in for the SDK client, so the AI tests never reach the network or
 * spend money. `respond` is called once per request: return a message for the
 * model to have "answered" with, or throw to stand in for an SDK error.
 */
export function stubAnthropic(respond: () => Anthropic.Message | Promise<Anthropic.Message>) {
  const requests: Record<string, unknown>[] = []
  const client = {
    messages: {
      create: async (params: Record<string, unknown>) => {
        requests.push(params)
        return respond()
      },
    },
  } as unknown as Anthropic
  return { client, requests }
}

export const usage = { input_tokens: 1770, output_tokens: 110 } as Anthropic.Usage

/** A response as the API sends it: text blocks, a stop reason and usage. */
export function message(
  text: string | null,
  stopReason: Anthropic.Message['stop_reason'] = 'end_turn',
): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5',
    content: text === null ? [] : [{ type: 'text', text, citations: null }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage,
  } as unknown as Anthropic.Message
}
