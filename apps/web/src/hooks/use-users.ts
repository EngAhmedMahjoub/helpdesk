import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createUser, fetchUsers, updateUser, usersQueryKey } from '@/lib/users'

/** Every user, as the admin list shows them. Admin only; the API returns 403. */
export function useUsers() {
  return useQuery({
    queryKey: usersQueryKey,
    queryFn: fetchUsers,
  })
}

export function useCreateUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createUser,
    // Refetch rather than splice the new user into the cache: the list's order
    // and fields are the API's to decide, and one extra GET is cheap here.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: usersQueryKey }),
  })
}

/** Deactivates or reactivates a user. Deactivating signs them out everywhere. */
export function useSetUserActive() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      updateUser(id, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: usersQueryKey }),
  })
}
