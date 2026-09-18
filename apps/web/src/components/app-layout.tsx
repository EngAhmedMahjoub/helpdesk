import { Link, NavLink, Outlet } from 'react-router'
import { cn } from 'cn'
import { ButtonSpinner } from '@/components/page-spinner'
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

/** Chrome shared by every signed-in screen. */
export default function AppLayout() {
  const currentUser = useCurrentUser()
  const signOut = useSignOut()

  const isAdmin = currentUser.data?.role === 'admin'
  const visibleItems = navItems.filter((item) => !item.adminOnly || isAdmin)

  return (
    <>
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 p-4">
          {/* Link, not NavLink: the brand is a way home, not a nav item, so it
              never takes the current-page styling Dashboard already shows. */}
          <Link className="font-semibold text-foreground" to="/">
            Helpdesk
          </Link>

          <nav aria-label="Main" className="flex items-center gap-4">
            {visibleItems.map((item) => (
              <NavLink
                className={({ isActive }) =>
                  cn(
                    'text-sm transition-colors hover:text-foreground',
                    isActive ? 'font-medium text-foreground' : 'text-muted-foreground',
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

          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{currentUser.data?.name}</span>
            <Button
              disabled={signOut.isPending}
              onClick={() => signOut.mutate()}
              size="sm"
              variant="outline"
            >
              {signOut.isPending && <ButtonSpinner />}
              {signOut.isPending ? 'Signing out…' : 'Sign out'}
            </Button>
          </div>
        </div>
      </header>

      <Outlet />
    </>
  )
}
