import type { ListTicketsQuery, TicketListResponse, TicketSummary } from '@helpdesk/shared'
import TableSkeleton, { type Column } from '@/components/table-skeleton'
import { TicketStatusBadge, TicketSubjectLink, Timestamp } from '@/components/ticket-cells'
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
import { escalationReasonLabels } from '@/lib/escalation'
import { studentLabel } from '@/lib/tickets'

// One list for the skeleton and the table, so their headers and widths cannot
// drift apart. Sums to 100%; Subject gets the most because it runs longest.
const columns: Column[] = [
  { label: 'Subject', width: 'w-[22%]' },
  { label: 'Student', width: 'w-[15%]' },
  { label: 'Status', width: 'w-[10%]' },
  { label: 'Category', width: 'w-[11%]' },
  { label: 'Assignee', width: 'w-[13%]' },
  // Wider than a Yes needed: it holds the reason now.
  { label: 'Needs agent', width: 'w-[13%]' },
  // Fits "28 Sept 2026, 16:10" at the page's full width; at 13% the year
  // pushed it past the cell and truncate cut it off.
  { label: 'Last activity', width: 'w-[16%]' },
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
        needsAgent={query.needsAgent}
        onAssignee={(assignee) => update({ assignee })}
        onNeedsAgent={(needsAgent) => update({ needsAgent })}
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
        <TicketSubjectLink ticket={ticket} />
      </TableCell>
      <TableCell
        className="truncate text-muted-foreground"
        title={`${ticket.studentName ?? ''} <${ticket.studentEmail}>`.trim()}
      >
        {studentLabel(ticket)}
      </TableCell>
      <TableCell>
        <TicketStatusBadge status={ticket.status} />
      </TableCell>
      <TableCell className="text-muted-foreground">
        {ticket.category ?? <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="truncate text-muted-foreground" title={ticket.assignee?.name}>
        {ticket.assignee?.name ?? 'Unassigned'}
      </TableCell>
      <TableCell>
        {/* The reason, not just "Yes", so an agent scanning the list knows
            which tickets wait on an approval and which on an answer (6.7).
            A flag without a reason, from before reasons existed, still reads. */}
        {ticket.needsAgent ? (
          <Badge className="max-w-full truncate" variant="destructive">
            {ticket.escalationReason ? escalationReasonLabels[ticket.escalationReason] : 'Yes'}
          </Badge>
        ) : (
          <span className="text-muted-foreground">No</span>
        )}
      </TableCell>
      <TableCell className="truncate text-muted-foreground">
        <Timestamp at={ticket.updatedAt} />
      </TableCell>
    </TableRow>
  )
}
