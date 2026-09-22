import { Link } from 'react-router'
import type { ListTicketsQuery, TicketListResponse, TicketSummary } from '@helpdesk/shared'
import TableSkeleton, { type Column } from '@/components/table-skeleton'
import TicketFilters, { type SortChoice } from '@/components/ticket-filters'
import TicketPagination from '@/components/ticket-pagination'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useTicketQuery } from '@/hooks/use-ticket-query'
import { useTickets } from '@/hooks/use-tickets'
import { compactDateTime, fullDateTime } from '@/lib/format'
import { studentLabel } from '@/lib/tickets'

// One list for the skeleton and the table, so their headers and widths cannot
// drift apart. Sums to 100%; Subject gets the most because it runs longest.
const columns: Column[] = [
  { label: 'Subject', width: 'w-[26%]' },
  { label: 'Student', width: 'w-[17%]' },
  { label: 'Status', width: 'w-[10%]' },
  { label: 'Category', width: 'w-[11%]' },
  { label: 'Assignee', width: 'w-[13%]' },
  { label: 'Needs agent', width: 'w-[10%]' },
  { label: 'Last activity', width: 'w-[13%]' },
]

export default function TicketsPage() {
  const { query, update } = useTicketQuery()
  const tickets = useTickets(query)

  const sort: SortChoice = `${query.sort}:${query.order}`

  return (
    <main className="mx-auto max-w-6xl p-8">
      <h1 className="text-2xl font-semibold text-foreground">Tickets</h1>
      <p className="mt-2 text-muted-foreground">
        Every ticket students have sent in, most recent activity first.
      </p>

      <TicketFilters
        assignee={query.assignee}
        category={query.category}
        onAssignee={(assignee) => update({ assignee })}
        onCategory={(category) => update({ category })}
        onSort={(choice) => {
          const [sortBy, order] = choice.split(':') as [ListTicketsQuery['sort'], 'asc' | 'desc']
          update({ sort: sortBy, order })
        }}
        onStatus={(status) => update({ status })}
        sort={sort}
        status={query.status}
      />

      <div className="mt-6">
        {tickets.isPending && <TableSkeleton columns={columns} label="Loading tickets" />}

        {tickets.isError && (
          <p className="text-destructive" role="alert">
            {tickets.error.message}
          </p>
        )}

        {tickets.data && <TicketsTable data={tickets.data} />}
      </div>

      {tickets.data && tickets.data.total > 0 && (
        <TicketPagination
          data={tickets.data}
          onPage={(page) => {
            update({ page }, { keepPage: true })
          }}
          onPageSize={(pageSize) => {
            // Back to page 1: page 4 of twenty-row pages is past the end of
            // fifty-row ones, and an empty page reads as no tickets at all.
            update({ pageSize })
          }}
        />
      )}
    </main>
  )
}

function TicketsTable({ data }: { data: TicketListResponse }) {
  if (data.tickets.length === 0) {
    return (
      <p className="text-muted-foreground" role="status">
        No tickets match these filters.
      </p>
    )
  }

  return (
    <Table className="table-fixed">
      <caption className="sr-only">Tickets matching the filters</caption>
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
        {data.tickets.map((ticket) => (
          <TicketRow key={ticket.id} ticket={ticket} />
        ))}
      </TableBody>
    </Table>
  )
}

function TicketRow({ ticket }: { ticket: TicketSummary }) {
  return (
    <TableRow>
      {/* Fixed columns cut long text off instead of widening to fit it; title
          keeps the whole value a hover away. */}
      <TableCell className="truncate font-medium" title={ticket.subject}>
        <Link className="text-foreground hover:underline" to={`/tickets/${String(ticket.id)}`}>
          {ticket.subject}
        </Link>
      </TableCell>
      <TableCell
        className="truncate text-muted-foreground"
        title={`${ticket.studentName ?? ''} <${ticket.studentEmail}>`.trim()}
      >
        {studentLabel(ticket)}
      </TableCell>
      <TableCell>
        {/* The word carries the meaning; the colour only seconds it, so a
            reader who cannot tell two badges apart loses nothing. */}
        <Badge variant={ticket.status === 'open' ? 'default' : 'outline'}>{ticket.status}</Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {ticket.category ?? <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="truncate text-muted-foreground" title={ticket.assignee?.name}>
        {ticket.assignee?.name ?? 'Unassigned'}
      </TableCell>
      <TableCell>
        {ticket.needsAgent ? (
          <Badge variant="destructive">Yes</Badge>
        ) : (
          <span className="text-muted-foreground">No</span>
        )}
      </TableCell>
      <TableCell className="truncate text-muted-foreground">
        <time dateTime={ticket.updatedAt} title={fullDateTime.format(new Date(ticket.updatedAt))}>
          {compactDateTime.format(new Date(ticket.updatedAt))}
        </time>
      </TableCell>
    </TableRow>
  )
}
