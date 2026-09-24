import express, { Router, type Response } from 'express'
import { Resend } from 'resend'
import { env } from '../env.ts'

// verify() uses only the secret passed to it; the client is simply how the SDK
// exposes it, and how Resend's docs verify a webhook.
const resend = new Resend(env.RESEND_API_KEY)

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
  (req, res) => {
    const id = req.header('svix-id')
    const timestamp = req.header('svix-timestamp')
    const signature = req.header('svix-signature')
    const payload: unknown = req.body

    if (!id || !timestamp || !signature || typeof payload !== 'string') {
      reject(res, 'missing signature headers')
      return
    }

    let type: string
    try {
      // Throws on a signature that does not match the body, and on a timestamp
      // outside the library's tolerance, so a captured request cannot be
      // replayed later.
      type = resend.webhooks.verify({
        payload,
        headers: { id, timestamp, signature },
        webhookSecret: env.RESEND_WEBHOOK_SECRET,
      }).type
    } catch {
      reject(res, 'signature does not verify')
      return
    }

    // Verified, and nothing more yet: reading the email and turning it into a
    // ticket are tasks 4.5 onward.
    console.log(`Accepted a Resend webhook: ${type}`)
    res.status(204).end()
  },
)
