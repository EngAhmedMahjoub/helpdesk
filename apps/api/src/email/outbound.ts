import { Resend } from 'resend'
import { env } from '../env.ts'

export type OutboundEmail = {
  to: string
  subject: string
  text: string
  /**
   * Message-IDs of the thread this email answers, oldest first. The last is the
   * message being replied to. Empty or absent starts a new thread.
   */
  thread?: string[]
}

/**
 * No Message-ID here: Resend's mail goes out through Amazon SES, which replaces
 * any Message-ID the request sets with its own (seen in a delivered email's
 * headers), and the send response does not report the one it used. A reply is
 * matched to its ticket through References instead, which carries the
 * student's original Message-ID.
 */
export type SentEmail = {
  /** Resend's id for the email, for looking it up in their dashboard or API. */
  resendId: string
}

/** The part of the Resend client this module uses, so tests can pass a fake. */
export type EmailClient = Pick<Resend, 'emails'>

export class EmailSendError extends Error {
  override name = 'EmailSendError'
}

export function createEmailSender(client: EmailClient, from: string) {
  return async function sendEmail(email: OutboundEmail): Promise<SentEmail> {
    const headers: Record<string, string> = {}
    const thread = email.thread ?? []
    const parent = thread.at(-1)
    if (parent) {
      // RFC 5322 §3.6.4: In-Reply-To names the parent; References carries the
      // whole chain, which is what mail clients group a thread by.
      headers['In-Reply-To'] = parent
      headers.References = thread.join(' ')
    }

    const { data, error } = await client.emails.send({
      from,
      to: email.to,
      subject: email.subject,
      text: email.text,
      headers,
    })

    // The SDK reports failure in the result rather than by throwing, so an
    // unchecked call would carry on as if the student had been answered.
    if (error || !data) {
      throw new EmailSendError(`Resend refused the email: ${error?.name ?? 'no response'}`, {
        cause: error,
      })
    }

    return { resendId: data.id }
  }
}

export const sendEmail = createEmailSender(new Resend(env.RESEND_API_KEY), env.EMAIL_FROM)
