import { Router } from 'express'
import { type PolishResponse, polishRequestSchema } from '@helpdesk/shared'
import { AiFailure } from '../ai/failure.ts'
import { polishText } from '../ai/polish.ts'
import { failedUsageLine, usageLine } from '../ai/usage.ts'
import { requireAuth } from '../auth/middleware.ts'
import { polishDailyLimit, polishRateLimit } from '../auth/rate-limit.ts'
import { parseBody, signedInUserId } from '../http.ts'

const NOT_POLISHED = 'Claude could not polish this text. Your text is unchanged.'

export const aiRouter = Router()

// Agents and admins alike: both write replies.
aiRouter.use(requireAuth)

/**
 * Tidies an agent's text with Claude (#323) and answers it. Nothing is saved
 * or sent: the agent reads the result in the box and sends it themselves.
 *
 * The limit runs before the body is validated, so a malformed request spends
 * the budget too; it reaches no model, but a caller scripting them should still
 * meet the same wall.
 *
 * Per user before the daily cap, so a request one user's own limit refuses
 * does not also spend everybody's.
 */
aiRouter.post('/polish', polishRateLimit, polishDailyLimit, async (req, res) => {
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
    const failed = failedUsageLine({ polish_by: userId }, error)
    if (failed) console.log(failed)
    // The reason alone: the message of a rejected request can quote it back.
    console.error(`AI polish failed: user=${userId} reason=${error.reason}`)
    res.status(502).json({ error: NOT_POLISHED })
  }
})
