import { Router } from 'express'
import { type PolishResponse, polishRequestSchema } from '@helpdesk/shared'
import { AiFailure } from '../ai/failure.ts'
import { polishText } from '../ai/polish.ts'
import { usageLine } from '../ai/usage.ts'
import { requireAuth } from '../auth/middleware.ts'
import { polishRateLimit } from '../auth/rate-limit.ts'
import { parseBody, signedInUserId } from '../http.ts'

const NOT_POLISHED = 'Claude could not polish this text. Your text is unchanged.'

export const aiRouter = Router()

// Agents and admins alike: both write replies.
aiRouter.use(requireAuth)

/**
 * Tidies an agent's text with Claude (#323) and answers it. Nothing is saved
 * or sent: the agent reads the result in the box and sends it themselves.
 *
 * The limit runs before the body is read, so a malformed request spends the
 * budget too; it reaches no model, but a caller scripting them should still
 * meet the same wall.
 */
aiRouter.post('/polish', polishRateLimit, async (req, res) => {
  const userId = signedInUserId(req, res)
  if (!userId) return

  const body = parseBody(polishRequestSchema, req, res)
  if (!body) return

  try {
    const { text, usage } = await polishText(req.app.locals.anthropic, body.text)
    console.log(usageLine({ polish_by: userId }, usage, 'polished'))
    const answer: PolishResponse = { text }
    res.json(answer)
  } catch (error) {
    if (!(error instanceof AiFailure)) throw error
    // A failed call the model answered is still billed, so it is still counted.
    if (error.usage)
      console.log(usageLine({ polish_by: userId }, error.usage, `failed_${error.reason}`))
    // The reason alone: the message of a rejected request can quote it back.
    console.error(`AI polish failed: user=${userId} reason=${error.reason}`)
    res.status(502).json({ error: NOT_POLISHED })
  }
})
