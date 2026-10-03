import { EmailSendError, type OutboundEmail, type SendEmail } from '../src/email/outbound.ts'

/**
 * A stand-in for the Resend sender, so no test emails anyone. Every send is
 * recorded in `emails`; with `failing` set, a send is refused the way Resend
 * refuses one, as an `EmailSendError`, and nothing is recorded.
 *
 * `failing` can be flipped mid-test, for a test that sends once and then has
 * the next send refused. Each caller makes and owns its own, so no two test
 * files share an outbox.
 */
export function fakeSender({ failing = false } = {}) {
  const sender = {
    emails: [] as OutboundEmail[],
    failing,
    sendEmail: (async (email) => {
      // drafts.test.ts asserts this exact text in the failure log.
      if (sender.failing) throw new EmailSendError('Resend refused the email: rate_limit_exceeded')
      sender.emails.push(email)
      return { resendId: 'resend-id' }
    }) satisfies SendEmail,
    /** Empties the outbox and accepts sends again, for a sender shared by a file's tests. */
    reset() {
      sender.emails.length = 0
      sender.failing = false
    },
  }
  return sender
}
