import { useQuery } from '@tanstack/react-query'
import { dashboardQueryKey, fetchDashboard } from '@/lib/dashboard'

/**
 * The ticket counts. Stale at once, unlike the app's 30-second default: almost
 * every change to a ticket moves a count, and listing each of those mutations
 * here to invalidate it would miss the next one added. Every visit refetches,
 * showing the cached counts until the new ones land.
 */
export function useDashboard() {
  return useQuery({ queryKey: dashboardQueryKey, queryFn: fetchDashboard, staleTime: 0 })
}
