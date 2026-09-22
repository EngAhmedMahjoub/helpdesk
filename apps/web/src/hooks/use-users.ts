import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CurrentUser, UpdateUserRequest } from '@helpdesk/shared'
import { currentUserQueryKey } from '@/lib/auth'
import { assigneesQueryKey, ticketQueryKeyPrefix, ticketsQueryKeyPrefix } from '@/lib/tickets'
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: usersQueryKey })
      // A new user can be assigned tickets at once.
      await queryClient.invalidateQueries({ queryKey: assigneesQueryKey })
    },
  })
}

/**
 * Changes any of a user's name, email, password and active flag. Deactivating
 * signs them out everywhere, and so does a new password.
 */
export function useUpdateUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: UpdateUserRequest }) =>
      updateUser(id, changes),
    onSuccess: async (_user, { id }) => {
      await queryClient.invalidateQueries({ queryKey: usersQueryKey })
      // Who can be assigned, and the name each ticket shows for its assignee,
      // follow a rename; a deactivation takes the user's tickets away as well.
      await queryClient.invalidateQueries({ queryKey: assigneesQueryKey })
      await queryClient.invalidateQueries({ queryKey: ticketsQueryKeyPrefix })
      await queryClient.invalidateQueries({ queryKey: ticketQueryKeyPrefix })
      // An admin editing their own row changes the name the header shows too.
      if (queryClient.getQueryData<CurrentUser | null>(currentUserQueryKey)?.id === id) {
        await queryClient.invalidateQueries({ queryKey: currentUserQueryKey })
      }
    },
  })
}
