import type { GetReceivingEmailResponseSuccess } from 'resend'

/** A received email as Resend's received-emails API returns it. */
export type ReceivedEmail = GetReceivingEmailResponseSuccess

/** A received email reduced to what a ticket needs. */
export type InboundEmail = {
  fromAddress: string
  /** The display name in the From header; null when it has none. */
  fromName: string | null
  subject: string
  /** The plain-text body as sent, quoted history included; empty when there was none. */
  text: string
  messageId: string
  /** The Message-ID this email answers; null when it starts a conversation. */
  inReplyTo: string | null
  /**
   * The thread's Message-IDs as the sender's client listed them, oldest first.
   * What a reply is matched to its ticket by: In-Reply-To names our reply, whose
   * Message-ID Amazon SES set and never reported, while References still carries
   * the student's own earlier IDs.
   */
  references: string[]
}

/** A header by name, ignoring case: Resend sends them lowercase, but nothing promises it. */
function header(email: ReceivedEmail, name: string): string | undefined {
  const headers = email.headers ?? {}
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name)
  return key === undefined ? undefined : headers[key]
}

/**
 * Every `<id>` in a header value, in order. Resend hands a References header
 * over as a JSON array string when it holds several IDs and as the bare ID when
 * it holds one, and the raw RFC 5322 form is space-separated; picking out the
 * bracketed tokens reads all three alike.
 */
function messageIds(value: string | undefined): string[] {
  return value?.match(/<[^<>\s"]+>/g) ?? []
}

/** The address in `Name <user@domain>`, or the whole value when it is bare. */
function address(from: string): string {
  return (/<([^<>]+)>/.exec(from)?.[1] ?? from).trim()
}

/**
 * The name before the address in a From header, unquoted. Read from the header
 * because Resend's top-level `from` field is the bare address.
 */
function displayName(from: string | undefined): string | null {
  const open = from?.indexOf('<') ?? -1
  if (!from || open <= 0) return null
  const name = from
    .slice(0, open)
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .trim()
  return name || null
}

export function parseInboundEmail(email: ReceivedEmail): InboundEmail {
  return {
    fromAddress: address(email.from),
    fromName: displayName(header(email, 'from')),
    subject: email.subject.trim(),
    text: email.text ?? '',
    messageId: email.message_id,
    inReplyTo: messageIds(header(email, 'in-reply-to'))[0] ?? null,
    references: messageIds(header(email, 'references')),
  }
}
