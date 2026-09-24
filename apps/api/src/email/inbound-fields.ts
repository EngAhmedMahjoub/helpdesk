import { NAME_MAX_LENGTH, emailField } from '@helpdesk/shared'
import type { InboundEmail } from './inbound.ts'

// Task 4.5a. The ticket and message columns are unbounded TEXT, and the webhook
// is the first writer anyone can reach by sending an email. An email is refused
// only when it is unusable; anything cosmetic is cut down instead, because a
// refused email is a student's message silently dropped.

export const SUBJECT_MAX_LENGTH = 200
// Above the 10,000 an agent reply may hold: inbound text carries the quoted
// history of the messages before it.
export const INBOUND_TEXT_MAX_LENGTH = 20_000

export const NO_SUBJECT = '(no subject)'
export const NO_TEXT = '(This email had no plain-text content.)'
export const TEXT_SHORTENED = '\n\n[Message shortened]'

/** What an inbound email may write to a ticket and its message. */
export type InboundTicketFields = {
  studentEmail: string
  studentName: string | null
  subject: string
  body: string
}

/**
 * `value` held to `max` characters, the last of them `marker` when it had to be
 * cut. Counted in code points, so a cut never splits an emoji or other
 * character that takes two UTF-16 units.
 */
function shorten(value: string, max: number, marker: string): string {
  const chars = Array.from(value)
  if (chars.length <= max) return value
  return chars.slice(0, max - Array.from(marker).length).join('') + marker
}

/**
 * The fields an inbound email writes, bounded, or null when it must be refused:
 * a sender that is malformed or too long to be a deliverable address, whom no
 * reply could reach.
 */
export function inboundTicketFields(email: InboundEmail): InboundTicketFields | null {
  const studentEmail = emailField.safeParse(email.fromAddress.trim())
  if (!studentEmail.success) return null

  const subject = email.subject.trim()
  const name = email.fromName?.trim()
  const text = email.text.trim()

  return {
    studentEmail: studentEmail.data,
    // Too long to be a real name is dropped rather than cut: half a name is not
    // one, and the ticket still shows the address.
    studentName: name && Array.from(name).length <= NAME_MAX_LENGTH ? name : null,
    subject: subject ? shorten(subject, SUBJECT_MAX_LENGTH, '…') : NO_SUBJECT,
    // The beginning is kept: it holds the student's new words, and what gets cut
    // is mostly quoted history the thread already has.
    body: text ? shorten(text, INBOUND_TEXT_MAX_LENGTH, TEXT_SHORTENED) : NO_TEXT,
  }
}
