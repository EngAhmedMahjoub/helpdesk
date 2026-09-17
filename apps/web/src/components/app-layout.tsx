import { Outlet } from 'react-router'
import { Button } from '@/components/ui/button'
import { useCurrentUser, useSignOut } from '@/hooks/use-auth'

/** Chrome shared by every signed-in screen. Navigation links are task 1.14. */
export default function AppLayout() {
  const currentUser = useCurrentUser()
  const signOut = useSignOut()

  return (
    <>
      <header className="border-b">
        <nav className="mx-auto flex max-w-5xl items-center justify-between gap-4 p-4">
          <span className="font-semibold text-foreground">Helpdesk</span>

          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{currentUser.data?.name}</span>
            <Button
              disabled={signOut.isPending}
              onClick={() => signOut.mutate()}
              size="sm"
              variant="outline"
            >
              {signOut.isPending ? 'Signing out…' : 'Sign out'}
            </Button>
          </div>
        </nav>
      </header>

      <Outlet />
    </>
  )
}
