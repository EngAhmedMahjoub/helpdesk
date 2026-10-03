import { Link } from 'react-router'
import type { TicketSummary } from '@helpdesk/shared'
import TableSkeleton, { type Column } from '@/components/table-skeleton'
import { TicketStatusBadge, TicketSubjectLink, Timestamp } from '@/components/ticket-cells'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { RECENT_TICKETS_QUERY, useRecentTickets } from '@/hooks/use-tickets'
import { studentLabel } from '@/lib/tickets'

// Shared by the skeleton and the table, as on the ticket list, so the columns
// do not jump when the rows land.
const columns: Column[] = [
  { label: 'Subject', width: 'w-[45%]' },
  { label: 'Student', width: 'w-[25%]' },
  { label: 'Status', width: 'w-[12%]' },
  { label: 'Received', width: 'w-[18%]' },
]

/** The full list in the same order, so "View all" continues where this stops. */
const allTicketsHref = `/tickets?sort=${RECENT_TICKETS_QUERY.sort}&order=${RECENT_TICKETS_QUERY.order}`

/** The newest tickets, each linking to its page (7.3). */
export default function RecentTickets() {
  const recent = useRecentTickets()

  return (
    <Card aria-labelledby="recent-tickets" role="region">
      <CardHeader>
        <CardTitle>
          <h2 id="recent-tickets">Recent tickets</h2>
        </CardTitle>
        <CardAction>
          <Link
            className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
            to={allTicketsHref}
          >
            View all tickets
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent>
        {recent.isPending && (
          <TableSkeleton
            columns={columns}
            label="Loading recent tickets"
            rows={RECENT_TICKETS_QUERY.pageSize}
          />
        )}

        {recent.isError && (
          <p className="text-destructive" role="alert">
            {recent.error.message}
          </p>
        )}

        {recent.data && <RecentTable tickets={recent.data.tickets} />}
      </CardContent>
    </Card>
  )
}

function RecentTable({ tickets }: { tickets: TicketSummary[] }) {
  if (tickets.length === 0) {
    return (
      <p className="text-muted-foreground" role="status">
        No tickets yet.
      </p>
    )
  }

  return (
    <Table className="table-fixed">
      <caption className="sr-only">The newest tickets, most recent first</caption>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead className={column.width} key={column.label}>
              {column.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {tickets.map((ticket) => (
          <TableRow key={ticket.id}>
            <TableCell className="truncate font-medium" title={ticket.subject}>
              <TicketSubjectLink ticket={ticket} />
            </TableCell>
            <TableCell className="truncate text-muted-foreground" title={ticket.studentEmail}>
              {studentLabel(ticket)}
            </TableCell>
            <TableCell>
              <TicketStatusBadge status={ticket.status} />
            </TableCell>
            <TableCell className="truncate text-muted-foreground">
              <Timestamp at={ticket.createdAt} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
