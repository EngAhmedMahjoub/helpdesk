import express, { Router, type Response } from 'express'
import type { WebhookEventPayload } from 'resend'
import { env } from '../env.ts'
import { ingestInboundEmail } from '../email/ingest.ts'
import { EmailFetchError } from '../email/receiving.ts'
import { resend } from '../email/resend.ts'

/** The reason alone, never the payload: that names the student and their subject. */
function reject(res: Response, reason: string) {
  console.warn(`Rejected a Resend webhook: ${reason}`)
  res.status(401).json({ error: 'Unauthorized' })
}

export const webhooksRouter = Router()

webhooksRouter.post(
  '/resend',
  // The raw text, whatever the Content-Type: the signature covers the exact
  // bytes Resend sent, and parsing then re-serialising the JSON would change
  // them. Mounted ahead of the app's express.json() for the same reason.
  express.text({ type: () => true }),
  async (req, res) => {
    const id = req.header('svix-id')
    const timestamp = req.header('svix-timestamp')
    const signature = req.header('svix-signature')
    const payload: unknown = req.body

    if (!id || !timestamp || !signature || typeof payload !== 'string') {
      reject(res, 'missing signature headers')
      return
    }

    let event: WebhookEventPayload
    try {
      // Throws on a signature that does not match the body, and on a timestamp
      // outside the library's tolerance, so a captured request cannot be
      // replayed later.
      event = resend.webhooks.verify({
        payload,
        headers: { id, timestamp, signature },
        webhookSecret: env.RESEND_WEBHOOK_SECRET,
      })
    } catch {
      reject(res, 'signature does not verify')
      return
    }

    // Acknowledged and dropped: the endpoint may be subscribed to more events
    // than inbound email, and a refusal would only make Resend redeliver them.
    if (event.type !== 'email.received') {
      res.status(204).end()
      return
    }

    let received
    try {
      // The event carries only metadata; the body and headers are fetched.
      received = await req.app.locals.fetchReceivedEmail(event.data.email_id)
    } catch (err) {
      if (!(err instanceof EmailFetchError)) throw err
      // Not acknowledged, so Resend delivers the event again later, by when a
      // passing outage may be over.
      console.error(err.message)
      res.status(502).json({ error: 'Could not read the email from Resend' })
      return
    }

    // Acknowledged whatever the outcome: a duplicate or a refused sender would
    // come out the same way on every redelivery. A database failure throws
    // instead, and its 500 has Resend try again.
    const outcome = await ingestInboundEmail(received, req.app.locals.queueProcessTicket)
    console.log(`Inbound email ${received.id}: ${outcome}`)
    res.status(204).end()
  },
)
