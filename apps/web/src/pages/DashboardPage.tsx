import { Link } from 'react-router'
import {
  type DashboardResponse,
  TICKET_CATEGORIES,
  TICKET_STATUSES,
  type TicketCategory,
  type TicketStatus,
} from '@helpdesk/shared'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useDashboard } from '@/hooks/use-dashboard'

const count = new Intl.NumberFormat('en')

const statusLabels: Record<TicketStatus, string> = {
  open: 'Open',
  resolved: 'Resolved',
  closed: 'Closed',
}

const categoryLabels: Record<TicketCategory, string> = {
  general: 'General',
  technical: 'Technical',
  refund: 'Refund',
}

export default function DashboardPage() {
  const dashboard = useDashboard()

  return (
    <main className="mx-auto max-w-6xl p-8">
      <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>

      <div className="mt-6">
        {dashboard.isPending && <DashboardSkeleton />}

        {dashboard.isError && (
          <p className="text-destructive" role="alert">
            {dashboard.error.message}
          </p>
        )}

        {dashboard.data && <Counts data={dashboard.data} />}
      </div>
    </main>
  )
}

function Counts({ data }: { data: DashboardResponse }) {
  return (
    <div className="flex flex-col gap-8">
      {/* The one number an agent acts on, so it leads and links to the work. */}
      <Card>
        <CardContent className="flex flex-wrap items-end justify-between gap-4">
          <dl>
            <dt className="text-base font-medium text-foreground">Needs an agent</dt>
            <dd className="mt-2 text-5xl font-semibold text-foreground">
              {count.format(data.needsAgent)}
            </dd>
          </dl>
          <Link
            className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
            to="/tickets?needsAgent=true"
          >
            View tickets needing an agent
          </Link>
        </CardContent>
      </Card>

      <TileRow
        heading="By status"
        tiles={TICKET_STATUSES.map((status) => ({
          label: statusLabels[status],
          value: data.byStatus[status],
        }))}
        total={data.total}
      />

      <TileRow
        heading="By category"
        tiles={[
          ...TICKET_CATEGORIES.map((category) => ({
            label: categoryLabels[category],
            value: data.byCategory[category],
          })),
          // Shown, not dropped: a ticket the AI has not reached yet still
          // belongs in the total the row adds up to.
          { label: 'Not yet classified', value: data.uncategorized },
        ]}
        total={data.total}
      />
    </div>
  )
}

type Tile = { label: string; value: number }

function TileRow({ heading, tiles, total }: { heading: string; tiles: Tile[]; total: number }) {
  return (
    <section aria-label={heading}>
      <h2 className="text-lg font-medium text-foreground">
        {heading}{' '}
        <span className="text-sm font-normal text-muted-foreground">
          of {count.format(total)} {total === 1 ? 'ticket' : 'tickets'}
        </span>
      </h2>
      <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {tiles.map((tile) => (
          // dt and dd straight inside the Card: a dl allows one wrapping div
          // per term, not the two that CardContent would make.
          <Card className="gap-1 px-3" key={tile.label} size="sm">
            <dt className="text-sm text-muted-foreground">{tile.label}</dt>
            <dd className="text-2xl font-semibold text-foreground">{count.format(tile.value)}</dd>
          </Card>
        ))}
      </dl>
    </section>
  )
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" role="status">
      <span className="sr-only">Loading the dashboard</span>
      <div aria-hidden="true" className="flex flex-col gap-8">
        <Skeleton className="h-36 w-full rounded-xl" />
        {[0, 1].map((row) => (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" key={row}>
            {[0, 1, 2, 3].map((tile) => (
              <Skeleton className="h-20 rounded-xl" key={tile} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
