import Anthropic from '@anthropic-ai/sdk'

/**
 * Why a ticket could not be analysed. The job (5.15) reads `retryable` to
 * decide between trying again and handing the ticket to a person.
 */
export type AiFailureReason =
  | 'refusal'
  | 'truncated'
  | 'unexpected_stop'
  | 'invalid_output'
  | 'rate_limited'
  | 'unavailable'
  | 'rejected'

/**
 * One error type for everything that can go wrong asking the model about a
 * ticket, so the job has one thing to catch and one flag to read.
 *
 * `usage` is carried where the model answered, because a failed call is still
 * billed: 5.17's token logging has to count it.
 */
export class AiFailure extends Error {
  override readonly name = 'AiFailure'

  constructor(
    readonly reason: AiFailureReason,
    readonly retryable: boolean,
    message: string,
    readonly usage?: Anthropic.Usage,
    options?: { cause?: unknown },
  ) {
    super(message, options)
  }
}

/**
 * The failure a stop reason means, or undefined when the model finished its
 * answer and it is worth parsing. Checked before parsing: a cut-off or refused
 * answer is not JSON, and reporting it as "invalid JSON" would hide why.
 */
export function failureForStop(
  stopReason: Anthropic.Message['stop_reason'],
  usage: Anthropic.Usage,
): AiFailure | undefined {
  switch (stopReason) {
    case 'end_turn':
      return undefined
    case 'refusal':
      // Not retried: the same ticket is refused again, and each try is billed.
      return new AiFailure('refusal', false, 'The model declined to answer this ticket', usage)
    case 'max_tokens':
    case 'model_context_window_exceeded':
      // Not retried either: the same input stops at the same place.
      return new AiFailure(
        'truncated',
        false,
        `The answer was cut off (stop reason: ${stopReason})`,
        usage,
      )
    default:
      // tool_use, stop_sequence, pause_turn: the request asks for none of
      // them, so one arriving means the request is not what this code thinks.
      return new AiFailure(
        'unexpected_stop',
        false,
        `Unexpected stop reason: ${stopReason ?? 'none'}`,
        usage,
      )
  }
}

/**
 * An error from the SDK, as the failure it means for the job. Anything that
 * did not come from Anthropic is returned untouched: that is a bug here, not a
 * failure of the model, and it should surface as itself.
 *
 * The SDK has already retried 429s, 5xx and dropped connections twice by the
 * time one reaches here, so these are the ones that outlasted that.
 */
export function failureForError(error: unknown): unknown {
  if (error instanceof AiFailure) return error

  if (error instanceof Anthropic.RateLimitError) {
    return new AiFailure('rate_limited', true, 'Rate limited by Anthropic', undefined, {
      cause: error,
    })
  }
  // Before the APIError fallback below: a dropped connection is an APIError
  // too, and would otherwise be taken for a request Anthropic refused.
  if (
    error instanceof Anthropic.APIConnectionError ||
    error instanceof Anthropic.InternalServerError
  ) {
    return new AiFailure(
      'unavailable',
      true,
      `Anthropic unavailable: ${error.message}`,
      undefined,
      {
        cause: error,
      },
    )
  }
  if (error instanceof Anthropic.APIError) {
    // 400, 401, 403, 404, 413, 422: the request or the key is wrong, and
    // sending it again changes neither.
    return new AiFailure(
      'rejected',
      false,
      `Anthropic rejected the request (${String(error.status)}): ${error.message}`,
      undefined,
      { cause: error },
    )
  }
  return error
}
