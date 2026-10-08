import { useEffect } from 'react'
import { Link, useRouteError } from 'react-router'
import { Button } from '@/components/ui/button'
import { reportError } from '@/lib/sentry'

/**
 * The fallback when a page throws while rendering. Without it React Router
 * shows its own developer screen, and in production that boundary swallows
 * the error, so nothing would reach Sentry.
 */
export default function RouteError() {
  const error = useRouteError()

  useEffect(() => {
    reportError(error)
  }, [error])

  return (
    <main className="mx-auto flex max-w-xl flex-col items-start gap-4 p-8">
      <h1 className="text-2xl font-semibold text-foreground">Something went wrong</h1>
      <p className="text-muted-foreground">
        This page hit an error. Reload to try again, or go back to the dashboard.
      </p>
      <div className="flex items-center gap-4">
        <Button onClick={() => window.location.reload()}>Reload</Button>
        <Link className="text-primary underline" to="/">
          Back to the dashboard
        </Link>
      </div>
    </main>
  )
}
