import { Navigate, Outlet } from 'react-router'
import PageSpinner from '@/components/page-spinner'
import { useCurrentUser } from '@/hooks/use-auth'

/**
 * Gate for everything behind a session. Hiding a route is not access control —
 * the API enforces permissions on every endpoint; this only spares a signed-out
 * visitor a screen full of failed requests.
 */
export default function RequireAuth() {
  const currentUser = useCurrentUser()

  if (currentUser.isPending) return <PageSpinner label="Checking your session" />

  if (!currentUser.data) return <Navigate replace to="/login" />

  return <Outlet />
}
