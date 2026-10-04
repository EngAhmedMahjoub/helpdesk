import { Link } from 'react-router'
import type { TicketStatus, TicketSummary } from '@helpdesk/shared'
import { Badge } from '@/components/ui/badge'
import { compactDateTime, fullDateTime } from '@/lib/format'

/**
 * The pieces a ticket row is made of wherever tickets are listed: the ticket
 * list and the dashboard's recent tickets (#270). The cells around them stay
 * with each table, since their widths and titles differ.
 */

/** The subject, linking to the ticket's page. */
export function TicketSubjectLink({ ticket }: { ticket: Pick<TicketSummary, 'id' | 'subject'> }) {
  return (
    <Link className="text-foreground hover:underline" to={`/tickets/${String(ticket.id)}`}>
      {ticket.subject}
    </Link>
  )
}

/**
 * The status as a badge. The word carries the meaning; the colour only seconds
 * it, so a reader who cannot tell two badges apart loses nothing.
 */
export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return (
    // Cased by CSS, not in the text: the stored value stays what tests and
    // screen readers get, the way the selects already do it.
    <Badge className="capitalize" variant={status === 'open' ? 'default' : 'outline'}>
      {status}
    </Badge>
  )
}

/** A stamp short enough for a narrow cell, spelled out in full on hover. */
export function Timestamp({ at }: { at: string }) {
  const date = new Date(at)
  return (
    <time dateTime={at} title={fullDateTime.format(date)}>
      {compactDateTime.format(date)}
    </time>
  )
}
