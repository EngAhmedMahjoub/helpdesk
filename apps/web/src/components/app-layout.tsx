import { Link, NavLink, Outlet } from 'react-router'
import { cn } from 'cn'
import { PendingLabel } from '@/components/page-spinner'
import ThemeSwitch from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { useCurrentUser, useSignOut } from '@/hooks/use-auth'

type NavItem = {
  to: string
  label: string
  /** Admin-only items are left out of the nav for agents. */
  adminOnly?: boolean
}

const navItems: NavItem[] = [
  { to: '/', label: 'Dashboard' },
  { to: '/tickets', label: 'Tickets' },
  { to: '/users', label: 'Users', adminOnly: true },
]

/** Chrome shared by every signed-in screen: a navy sidebar, stacked on top at phone width. */
export default function AppLayout() {
  const currentUser = useCurrentUser()
  const signOut = useSignOut()

  const isAdmin = currentUser.data?.role === 'admin'
  const visibleItems = navItems.filter((item) => !item.adminOnly || isAdmin)

  return (
    <div className="flex min-h-svh flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col gap-6 bg-sidebar py-5 text-sidebar-foreground md:sticky md:top-0 md:h-svh md:w-60 md:py-7">
        <div className="px-6">
          {/* Link, not NavLink: the brand is a way home, not a nav item, so it
              never takes the current-page styling Dashboard already shows. */}
          <Link
            className="rounded-sm text-lg font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            to="/"
          >
            Helpdesk
          </Link>
          <p className="text-sm text-sidebar-foreground/80">Student Support Office</p>
        </div>

        <nav aria-label="Main" className="flex flex-wrap md:flex-col">
          {visibleItems.map((item) => (
            <NavLink
              className={({ isActive }) =>
                cn(
                  'border-l-3 px-6 py-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-inset',
                  isActive
                    ? 'border-sidebar-ring bg-sidebar-accent font-semibold text-sidebar-accent-foreground'
                    : 'border-transparent hover:text-sidebar-accent-foreground',
                )
              }
              // end, or Dashboard at "/" would stay active on every route.
              end={item.to === '/'}
              key={item.to}
              to={item.to}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex flex-col gap-3 px-6 md:mt-auto">
          <ThemeSwitch />
          <div className="flex items-center justify-between gap-3">
            <span className="truncate text-sm">{currentUser.data?.name}</span>
            <Button
              className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              disabled={signOut.isPending}
              onClick={() => signOut.mutate()}
              size="sm"
              variant="ghost"
            >
              <PendingLabel busy="Signing out…" pending={signOut.isPending}>
                Sign out
              </PendingLabel>
            </Button>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}
