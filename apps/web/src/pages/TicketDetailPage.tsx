import { ArrowLeft } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { type TicketDetail, ticketIdSchema } from '@helpdesk/shared'
import MessageThread from '@/components/message-thread'
import ReplyBox from '@/components/reply-box'
import TicketControls from '@/components/ticket-controls'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useTicket } from '@/hooks/use-tickets'
import { dateAndTime } from '@/lib/format'
import { studentLabel } from '@/lib/tickets'
import { isApiError } from '@/lib/api'

export default function TicketDetailPage() {
  const { id } = useParams()
  // The API's own rule, so /tickets/abc is the same "no such ticket" here as
  // there, without a request that could only come back 404.
  const parsed = ticketIdSchema.safeParse(id ?? '')

  return (
    <main className="mx-auto max-w-4xl p-8">
      {/* A button to look at, a link underneath: it goes somewhere, so it
          keeps an href — openable in a new tab, and read out as a link. */}
      <Button asChild size="sm" variant="outline">
        <Link to="/tickets">
          <ArrowLeft aria-hidden />
          All tickets
        </Link>
      </Button>

      {parsed.success ? <Ticket id={parsed.data} /> : <NotFound />}
    </main>
  )
}

function Ticket({ id }: { id: number }) {
  const ticket = useTicket(id)

  if (ticket.isPending) return <Loading />

  if (ticket.isError) {
    return isApiError(ticket.error, 404) ? (
      <NotFound />
    ) : (
      <p className="mt-6 text-destructive" role="alert">
        {ticket.error.message}
      </p>
    )
  }

  const student = studentLabel(ticket.data)

  return (
    <>
      <Header ticket={ticket.data} />

      <section aria-labelledby="thread-heading" className="mt-8">
        <h2 className="sr-only" id="thread-heading">
          Messages
        </h2>
        <MessageThread messages={ticket.data.messages} studentName={student} />
      </section>

      <section aria-labelledby="reply-heading" className="mt-8">
        <h2 className="sr-only" id="reply-heading">
          Reply
        </h2>
        <ReplyBox student={student} ticketId={ticket.data.id} />
      </section>
    </>
  )
}

function Header({ ticket }: { ticket: TicketDetail }) {
  return (
    <header className="mt-4">
      <h1 className="text-2xl font-semibold text-foreground">{ticket.subject}</h1>

      <p className="mt-2 text-muted-foreground">
        {ticket.studentName ? `${ticket.studentName} · ` : ''}
        <a
          className="hover:text-foreground"
          href={`mailto:${encodeURIComponent(ticket.studentEmail)}`}
        >
          {ticket.studentEmail}
        </a>
      </p>

      <TicketControls ticket={ticket} />

      {ticket.summary && (
        <p className="mt-4 rounded-lg border bg-muted/40 p-4 text-foreground">
          <span className="font-medium">Summary: </span>
          {ticket.summary}
        </p>
      )}

      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
        <Stamp label="Opened" value={ticket.createdAt} />
        <Stamp label="Last activity" value={ticket.updatedAt} />
        {ticket.autoCloseAt && <Stamp label="Closes automatically" value={ticket.autoCloseAt} />}
      </dl>
    </header>
  )
}

function Stamp({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1">
      <dt>{label}:</dt>
      <dd>
        <time dateTime={value}>{dateAndTime.format(new Date(value))}</time>
      </dd>
    </div>
  )
}

function Loading() {
  return (
    <div aria-busy="true" className="mt-4 flex flex-col gap-4" role="status">
      <span className="sr-only">Loading ticket</span>
      <Skeleton aria-hidden className="h-8 w-2/3" />
      <Skeleton aria-hidden className="h-5 w-1/3" />
      <Skeleton aria-hidden className="h-24 w-full" />
      <Skeleton aria-hidden className="h-24 w-full" />
    </div>
  )
}

function NotFound() {
  return (
    <div className="mt-8">
      <h1 className="text-2xl font-semibold text-foreground">Ticket not found</h1>
      <p className="mt-2 text-muted-foreground">
        It may have been deleted, or the address may be wrong.{' '}
        <Link className="underline hover:text-foreground" to="/tickets">
          Back to the ticket list
        </Link>
        .
      </p>
    </div>
  )
}
