import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { currentUserQueryKey, fetchCurrentUser, logout } from '@/lib/auth'

/** The signed-in user, or `null` once the session check comes back empty. */
export function useCurrentUser() {
  return useQuery({
    queryKey: currentUserQueryKey,
    queryFn: fetchCurrentUser,
  })
}

export function useSignOut() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: logout,
    // Leave the protected tree before clearing, or the guard re-runs the
    // session check on a cache it is still mounted against. Everything goes:
    // whatever was cached belonged to the session that just ended.
    onSuccess: async () => {
      await navigate('/login', { replace: true })
      queryClient.clear()
    },
  })
}
