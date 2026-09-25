import type { Resend } from 'resend'
import { env } from '../env.ts'
import { isStorableMessageId } from './message-id.ts'
import { resend } from './resend.ts'

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
  /**
   * Resend's id for the email, for looking it up in their dashboard or API.
   * Null when the recipient was on a reserved domain and nothing was sent.
   */
  resendId: string | null
}

export type SendEmail = (email: OutboundEmail) => Promise<SentEmail>

/** The part of the Resend client this module uses, so tests can pass a fake. */
export type EmailClient = Pick<Resend, 'emails'>

export class EmailSendError extends Error {
  override name = 'EmailSendError'
}

// RFC 2606 reserves these, so no real student can have an address on one. The
// seeded sample tickets and the end-to-end students live on them: mailing those
// would bounce, and bounces count against the Resend account, or, with the
// test env's fake key, fail every reply the e2e suite sends.
const RESERVED_TLDS = ['test', 'example', 'invalid', 'localhost']
const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org']

function isReservedAddress(address: string): boolean {
  const domain = address.slice(address.lastIndexOf('@') + 1).toLowerCase()
  const tld = domain.slice(domain.lastIndexOf('.') + 1)
  return (
    RESERVED_TLDS.includes(tld) ||
    RESERVED_DOMAINS.some((reserved) => domain === reserved || domain.endsWith(`.${reserved}`))
  )
}

export function createEmailSender(client: EmailClient, from: string): SendEmail {
  return async function sendEmail(email) {
    if (isReservedAddress(email.to)) return { resendId: null }

    const headers: Record<string, string> = {}
    // Checked again here, not only where IDs are stored: these become raw header
    // values, and an ID with a CR/LF in it could add headers of its own (#210).
    const thread = (email.thread ?? []).filter(isStorableMessageId)
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

export const sendEmail: SendEmail = createEmailSender(resend, env.EMAIL_FROM)
