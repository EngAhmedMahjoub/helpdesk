import { useEffect, useState } from 'react'
import type { HealthResponse } from '@helpdesk/shared'

function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<HealthResponse>
      })
      .then(setHealth)
      .catch((err: Error) => setError(err.message))
  }, [])

  return (
    <main>
      <h1>Helpdesk</h1>
      {error && <p>API unreachable: {error}</p>}
      {health && <p>API status: {health.status} ({health.timestamp})</p>}
      {!health && !error && <p>Checking API…</p>}
    </main>
  )
}

export default App
