import type { DashboardResponse } from '@helpdesk/shared'
import { apiRequest } from '@/lib/api'

export const dashboardQueryKey = ['dashboard'] as const

export function fetchDashboard(): Promise<DashboardResponse> {
  return apiRequest<DashboardResponse>('/dashboard')
}
