import type { RouteObject } from 'react-router'
import HomePage from '@/pages/HomePage'
import LoginPage from '@/pages/LoginPage'
import NotFoundPage from '@/pages/NotFoundPage'

/**
 * The route table, kept apart from the browser router so tests can mount the
 * same routes through a memory router.
 */
export const routes: RouteObject[] = [
  { path: '/', Component: HomePage },
  { path: '/login', Component: LoginPage },
  { path: '*', Component: NotFoundPage },
]
