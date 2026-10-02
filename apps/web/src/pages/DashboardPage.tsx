import { Link } from 'react-router'
import {
  type DashboardResponse,
  TICKET_CATEGORIES,
  TICKET_STATUSES,
  type TicketCategory,
  type TicketStatus,
} from '@helpdesk/shared'
import CountBarChart from '@/components/count-bar-chart'
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

// Fixed to the entity, never to its rank, so Open stays blue whatever the
// counts. Status and category take different slots, so no colour means two
// things on one page. Not the destructive red: a colour here names, it does
// not warn.
const statusColors: Record<TicketStatus, string> = {
  open: 'var(--series-1)',
  resolved: 'var(--series-2)',
  closed: 'var(--series-3)',
}

const categoryColors: Record<TicketCategory, string> = {
  general: 'var(--series-4)',
  technical: 'var(--series-5)',
  refund: 'var(--series-6)',
}

const UNCATEGORIZED_COLOR = 'var(--series-7)'

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

      <div className="grid gap-8 md:grid-cols-2">
        <CountBarChart
          bars={TICKET_STATUSES.map((status) => ({
            label: statusLabels[status],
            count: data.byStatus[status],
            color: statusColors[status],
          }))}
          heading="By status"
          total={data.total}
        />

        <CountBarChart
          bars={[
            ...TICKET_CATEGORIES.map((category) => ({
              label: categoryLabels[category],
              count: data.byCategory[category],
              color: categoryColors[category],
            })),
            // Shown, not dropped: a ticket the AI has not reached yet still
            // belongs in the total the bars add up to.
            { label: 'Not yet classified', count: data.uncategorized, color: UNCATEGORIZED_COLOR },
          ]}
          heading="By category"
          total={data.total}
        />
      </div>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" role="status">
      <span className="sr-only">Loading the dashboard</span>
      <div aria-hidden="true" className="flex flex-col gap-8">
        <Skeleton className="h-36 w-full rounded-xl" />
        <div className="grid gap-8 md:grid-cols-2">
          <Skeleton className="h-56 rounded-xl" />
          <Skeleton className="h-56 rounded-xl" />
        </div>
      </div>
    </div>
  )
}
