import { Navigate, Outlet } from 'react-router'
import PageSpinner from '@/components/page-spinner'
import { useCurrentUser } from '@/hooks/use-auth'

/**
 * Gate for admin-only screens. Sits inside RequireAuth, so by the time it runs
 * the session check has already resolved and this reads it from the cache.
 *
 * Not a boundary: `requireAdmin` on the API is. This spares an agent who types
 * the URL a screen whose every request comes back 403, the same way hiding the
 * nav link spares them a link that leads there.
 */
export default function RequireAdmin() {
  const currentUser = useCurrentUser()

  if (currentUser.isPending) return <PageSpinner label="Checking your session" />

  // Home rather than /login: they are signed in, so sending them to the login
  // form would say the session was the problem. replace, so Back does not
  // bounce them straight back into the redirect.
  if (currentUser.data?.role !== 'admin') return <Navigate replace to="/" />

  return <Outlet />
}
