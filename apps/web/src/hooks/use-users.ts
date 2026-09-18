import { useQuery } from '@tanstack/react-query'
import { fetchUsers, usersQueryKey } from '@/lib/users'

/** Every user, as the admin list shows them. Admin only; the API returns 403. */
export function useUsers() {
  return useQuery({
    queryKey: usersQueryKey,
    queryFn: fetchUsers,
  })
}
