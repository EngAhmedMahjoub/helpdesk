import { Navigate, Outlet } from 'react-router'
import { useCurrentUser } from '@/hooks/use-auth'

/**
 * Gate for everything behind a session. Hiding a route is not access control —
 * the API enforces permissions on every endpoint; this only spares a signed-out
 * visitor a screen full of failed requests.
 */
export default function RequireAuth() {
  const currentUser = useCurrentUser()

  // A placeholder while the session check is in flight. The real loading state
  // belongs to the app layout in task 1.14.
  if (currentUser.isPending) return <p className="p-8 text-muted-foreground">Loading…</p>

  if (!currentUser.data) return <Navigate replace to="/login" />

  return <Outlet />
}
