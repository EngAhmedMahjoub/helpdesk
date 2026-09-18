import { useState } from 'react'
import type { UserSummary } from '@helpdesk/shared'
import { ButtonSpinner } from '@/components/page-spinner'
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
import { useSetUserActive } from '@/hooks/use-users'

type Props = {
  user: UserSummary
  /** The signed-in admin's own row: the API refuses to let them deactivate it. */
  isSelf: boolean
  onChanged: (message: string) => void
}

/**
 * Deactivate or reactivate, whichever the row's state calls for. Each button
 * names its user, since every row's reads the same and a screen reader listing
 * the page's buttons would otherwise offer ten identical "Deactivate"s.
 */
export default function UserStatusAction({ user, isSelf, onChanged }: Props) {
  if (isSelf) return <span className="text-sm text-muted-foreground">You</span>

  // The seeded admin: the API refuses to deactivate them, so a button that
  // could only fail is not offered. Reactivation still is, should they ever be
  // found inactive — it only restores the account the flag exists to keep.
  if (user.isProtected && user.isActive) {
    return <span className="text-sm text-muted-foreground">Protected</span>
  }

  return user.isActive ? (
    <DeactivateAction onChanged={onChanged} user={user} />
  ) : (
    <ReactivateAction onChanged={onChanged} user={user} />
  )
}

/**
 * Behind a confirmation, because it cannot be quietly undone: reactivating
 * restores the account, but the sessions it ended stay ended, and the agent is
 * thrown out of whatever they were halfway through.
 */
function DeactivateAction({ user, onChanged }: Omit<Props, 'isSelf'>) {
  const [open, setOpen] = useState(false)
  const setActive = useSetUserActive()

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) setActive.reset()
  }

  return (
    <AlertDialog onOpenChange={handleOpenChange} open={open}>
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

        {setActive.isError && (
          <p className="text-sm text-destructive" role="alert">
            {setActive.error.message}
          </p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={setActive.isPending}
            onClick={(event) => {
              // Held open until the API answers, so a failure is shown here,
              // beside the button that caused it, rather than lost on close.
              event.preventDefault()
              setActive.mutate(
                { id: user.id, isActive: false },
                {
                  onSuccess: () => {
                    handleOpenChange(false)
                    onChanged(`${user.name} was deactivated and signed out.`)
                  },
                },
              )
            }}
            variant="destructive"
          >
            {setActive.isPending && <ButtonSpinner />}
            {setActive.isPending ? 'Deactivating…' : 'Deactivate'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** No confirmation: it only gives back access, and ends nothing. */
function ReactivateAction({ user, onChanged }: Omit<Props, 'isSelf'>) {
  const setActive = useSetUserActive()

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        aria-label={`Reactivate ${user.name}`}
        disabled={setActive.isPending}
        onClick={() =>
          setActive.mutate(
            { id: user.id, isActive: true },
            { onSuccess: () => onChanged(`${user.name} was reactivated and can sign in again.`) },
          )
        }
        size="sm"
        variant="outline"
      >
        {setActive.isPending && <ButtonSpinner />}
        {setActive.isPending ? 'Reactivating…' : 'Reactivate'}
      </Button>
      {setActive.isError && (
        <p className="text-xs text-destructive" role="alert">
          {setActive.error.message}
        </p>
      )}
    </div>
  )
}
