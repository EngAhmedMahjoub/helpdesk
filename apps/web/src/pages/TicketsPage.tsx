import { Link, useSearchParams } from 'react-router'
import {
  type ListTicketsQuery,
  type TicketListResponse,
  type TicketSummary,
  listTicketsQuerySchema,
} from '@helpdesk/shared'
import TableSkeleton, { type Column } from '@/components/table-skeleton'
import TicketFilters, { type SortChoice } from '@/components/ticket-filters'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useTickets } from '@/hooks/use-tickets'

// Built once rather than per row. undefined locale means the reader's own.
// Short enough for a narrow column; the cell's title carries the full stamp.
const updatedFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})
const fullFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' })

// One list for the skeleton and the table, so their headers and widths cannot
// drift apart. Sums to 100%; Subject gets the most because it runs longest.
const columns: Column[] = [
  { label: 'Subject', width: 'w-[30%]' },
  { label: 'Student', width: 'w-[21%]' },
  { label: 'Status', width: 'w-[11%]' },
  { label: 'Category', width: 'w-[12%]' },
  { label: 'Needs agent', width: 'w-[11%]' },
  { label: 'Last activity', width: 'w-[15%]' },
]

/**
 * The filters, sort and page live in the URL rather than in component state, so
 * a filtered list can be linked to, survives a reload, and the back button
 * steps through the choices an agent made.
 */
function useTicketQuery() {
  const [searchParams, setSearchParams] = useSearchParams()

  // A URL nobody typed by hand always parses. A hand-edited one that does not
  // falls back to the default list rather than showing an error a visitor
  // cannot act on; the controls below then rewrite it.
  const parsed = listTicketsQuerySchema.safeParse(Object.fromEntries(searchParams))
  const query: ListTicketsQuery = parsed.success ? parsed.data : listTicketsQuerySchema.parse({})

  function update(changes: Partial<ListTicketsQuery>, options: { keepPage?: boolean } = {}) {
    const next = { ...query, ...changes }
    // Any change but paging returns to page 1: page 3 of the old filter is
    // rarely a page of the new one, and an empty page looks like no tickets.
    if (!options.keepPage) next.page = 1

    setSearchParams(
      Object.fromEntries(
        Object.entries(next)
          .filter(([, value]) => value !== undefined && value !== '')
          .map(([key, value]) => [key, String(value)]),
      ),
    )
  }

  return { query, update }
}

export default function TicketsPage() {
  const { query, update } = useTicketQuery()
  const tickets = useTickets(query)

  const sort: SortChoice = `${query.sort ?? 'updatedAt'}:${query.order ?? 'desc'}`

  return (
    <main className="mx-auto max-w-6xl p-8">
      <h1 className="text-2xl font-semibold text-foreground">Tickets</h1>
      <p className="mt-2 text-muted-foreground">
        Every ticket students have sent in, most recent activity first.
      </p>

      <TicketFilters
        category={query.category}
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
        <Pagination
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
        {ticket.studentName ?? ticket.studentEmail}
      </TableCell>
      <TableCell>
        {/* The word carries the meaning; the colour only seconds it, so a
            reader who cannot tell two badges apart loses nothing. */}
        <Badge variant={ticket.status === 'open' ? 'default' : 'outline'}>{ticket.status}</Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {ticket.category ?? <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell>
        {ticket.needsAgent ? (
          <Badge variant="destructive">Yes</Badge>
        ) : (
          <span className="text-muted-foreground">No</span>
        )}
      </TableCell>
      <TableCell className="truncate text-muted-foreground">
        <time dateTime={ticket.updatedAt} title={fullFormat.format(new Date(ticket.updatedAt))}>
          {updatedFormat.format(new Date(ticket.updatedAt))}
        </time>
      </TableCell>
    </TableRow>
  )
}

// The sizes an agent picks between. Each is within the API's cap of 100.
const PAGE_SIZES = [5, 10, 20, 50] as const

function Pagination({
  data,
  onPage,
  onPageSize,
}: {
  data: TicketListResponse
  onPage: (page: number) => void
  onPageSize: (pageSize: number) => void
}) {
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize))
  const first = (data.page - 1) * data.pageSize + 1
  const last = first + data.tickets.length - 1

  return (
    <nav aria-label="Pagination" className="mt-6 flex items-center justify-between gap-4">
      {/* A live region: the numbers change without the page moving, and the
          buttons that changed them keep focus, so nothing else announces it. */}
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {data.tickets.length === 0
          ? `No tickets on page ${String(data.page)} of ${String(data.total)}`
          : `Showing ${String(first)}–${String(last)} of ${String(data.total)}`}
      </p>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Label className="text-sm font-normal text-muted-foreground" htmlFor="rows-per-page">
            Rows per page
          </Label>
          <Select
            onValueChange={(value) => {
              onPageSize(Number(value))
            }}
            value={String(data.pageSize)}
          >
            <SelectTrigger className="w-20" id="rows-per-page" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* The API's own page size, when it is not one of the choices —
                  a hand-typed ?pageSize=7 would otherwise show an empty box. */}
              {[...new Set([...PAGE_SIZES, data.pageSize])]
                .sort((a, b) => a - b)
                .map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Button
            disabled={data.page <= 1}
            onClick={() => {
              onPage(data.page - 1)
            }}
            size="sm"
            variant="outline"
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {data.page} of {pages}
          </span>
          <Button
            disabled={data.page >= pages}
            onClick={() => {
              onPage(data.page + 1)
            }}
            size="sm"
            variant="outline"
          >
            Next
          </Button>
        </div>
      </div>
    </nav>
  )
}
