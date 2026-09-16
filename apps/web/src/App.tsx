import { useCallback, useEffect, useState } from 'react'
import type { HealthResponse } from '@helpdesk/shared'
import { Button } from '@/components/ui/button'

function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadHealth = useCallback(() => {
    fetch('/api/health')
      .then((res) => {
        // 503 still carries a health body (database down)
        if (!res.ok && res.status !== 503) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<HealthResponse>
      })
      .then(setHealth)
      .catch((err: Error) => setError(err.message))
  }, [])

  useEffect(loadHealth, [loadHealth])

  const checkAgain = () => {
    setHealth(null)
    setError(null)
    loadHealth()
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col items-start gap-4 p-8">
      <h1 className="text-2xl font-semibold text-foreground">Helpdesk</h1>
      {error && <p className="text-destructive">API unreachable: {error}</p>}
      {health && (
        <p className="text-muted-foreground">
          API status: {health.status}, database: {health.database} ({health.timestamp})
        </p>
      )}
      {!health && !error && <p className="text-muted-foreground">Checking API…</p>}
      <Button onClick={checkAgain}>Check again</Button>
    </main>
  )
}

export default App
