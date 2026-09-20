import type { RouteObject } from 'react-router'
import AppLayout from '@/components/app-layout'
import RequireAdmin from '@/components/require-admin'
import RequireAuth from '@/components/require-auth'
import HomePage from '@/pages/HomePage'
import LoginPage from '@/pages/LoginPage'
import NotFoundPage from '@/pages/NotFoundPage'
import TicketDetailPage from '@/pages/TicketDetailPage'
import TicketsPage from '@/pages/TicketsPage'
import UsersPage from '@/pages/UsersPage'

/**
 * The route table, kept apart from the browser router so tests can mount the
 * same routes through a memory router.
 */
export const routes: RouteObject[] = [
  { path: '/login', Component: LoginPage },
  {
    Component: RequireAuth,
    children: [
      {
        Component: AppLayout,
        children: [
          { index: true, Component: HomePage },
          { path: 'tickets', Component: TicketsPage },
          { path: 'tickets/:id', Component: TicketDetailPage },
          {
            Component: RequireAdmin,
            children: [{ path: 'users', Component: UsersPage }],
          },
        ],
      },
    ],
  },
  { path: '*', Component: NotFoundPage },
]
