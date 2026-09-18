import { useQuery } from '@tanstack/react-query'
import type { HealthResponse } from '@helpdesk/shared'
import { Button } from '@/components/ui/button'
import { apiRequest } from '@/lib/api'

export default function HomePage() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => apiRequest<HealthResponse>('/health', { acceptStatus: [503] }),
  })

  return (
    <main className="mx-auto flex max-w-xl flex-col items-start gap-4 p-8">
      <h1 className="text-2xl font-semibold text-foreground">Helpdesk</h1>
      {health.isPending && <p className="text-muted-foreground">Checking API…</p>}
      {health.isError && (
        <p className="text-destructive">API unreachable: {health.error.message}</p>
      )}
      {health.data && (
        <p className="text-muted-foreground">
          API status: {health.data.status}, database: {health.data.database} (
          {health.data.timestamp})
        </p>
      )}
      <Button onClick={() => void health.refetch()}>Check again</Button>
    </main>
  )
}
