import type { UserSummary } from '@helpdesk/shared'
import { PendingLabel } from '@/components/page-spinner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import type { useUpdateUser } from '@/hooks/use-users'

/**
 * Deactivation keeps its confirmation, because it cannot be quietly undone:
 * reactivating restores the account, but the sessions it ended stay ended.
 * Reactivation only gives back access and asks nothing.
 */
export default function UserAccessControl({
  user,
  isSelf,
  canSetActive,
  onChange,
  setAccess,
}: {
  user: UserSummary
  isSelf: boolean
  canSetActive: boolean
  onChange: (isActive: boolean) => void
  setAccess: ReturnType<typeof useUpdateUser>
}) {
  const failure = setAccess.isError && (
    <p className="text-sm text-destructive" role="alert">
      {setAccess.error.message}
    </p>
  )

  if (!canSetActive) {
    return (
      <p className="text-sm text-muted-foreground">
        {isSelf ? 'You cannot deactivate your own account.' : 'This account cannot be deactivated.'}
      </p>
    )
  }

  if (!user.isActive) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-muted-foreground">Deactivated. They cannot sign in.</p>
        <Button
          aria-label={`Reactivate ${user.name}`}
          disabled={setAccess.isPending}
          onClick={() => onChange(true)}
          size="sm"
          variant="outline"
        >
          <PendingLabel busy="Reactivating…" pending={setAccess.isPending}>
            Reactivate
          </PendingLabel>
        </Button>
        {failure}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-sm text-muted-foreground">Active. They can sign in.</p>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button aria-label={`Deactivate ${user.name}`} size="sm" variant="outline">
            Deactivate
          </Button>
        </AlertDialogTrigger>

        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {user.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They are signed out everywhere at once and cannot sign in until you reactivate them.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {failure}

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={setAccess.isPending}
              onClick={(event) => {
                // Held open until the API answers, so a failure is shown here,
                // beside the button that caused it, rather than lost on close.
                event.preventDefault()
                onChange(false)
              }}
              variant="destructive"
            >
              <PendingLabel busy="Deactivating…" pending={setAccess.isPending}>
                Deactivate
              </PendingLabel>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
