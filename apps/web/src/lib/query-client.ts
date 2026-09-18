import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { ApiError } from '@/lib/api'
import { currentUserQueryKey } from '@/lib/auth'

/**
 * Any 401 means the session is gone: expired, signed out elsewhere, or ended by
 * an admin deactivating the account. Marking the current user as nobody is what
 * sends the app to /login, through RequireAuth.
 *
 * Without this only /auth/me could do that. Every other request would show its
 * own error instead, so a deactivated agent would sit on a broken screen and
 * not be signed out until the session check happened to run again.
 *
 * Everything else cached goes too: it was fetched with the session that just
 * ended, and the next person to sign in at this browser should not see it.
 */
function endSession(client: QueryClient, error: unknown): void {
  if (!(error instanceof ApiError) || error.status !== 401) return

  client.setQueryData(currentUserQueryKey, null)
  client.removeQueries({ predicate: (query) => query.queryKey[0] !== currentUserQueryKey[0] })
}

/**
 * A factory rather than only a singleton, so tests can mount the app against a
 * fresh cache that still behaves exactly like the one in the browser.
 */
export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: (error) => endSession(client, error) }),
    mutationCache: new MutationCache({ onError: (error) => endSession(client, error) }),
    defaultOptions: {
      queries: {
        // Retrying a 4xx never helps: a 401 means the session is gone and
        // should send the user to /login now, not three attempts from now.
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status < 500) return false
          return failureCount < 2
        },
        staleTime: 30_000,
      },
    },
  })
  return client
}

export const queryClient = createQueryClient()
