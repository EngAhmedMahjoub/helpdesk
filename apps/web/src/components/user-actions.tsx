import { type Change, type Party, type UserSummary, authorise } from '@helpdesk/shared'
import EditUserDialog from '@/components/edit-user-dialog'

type Props = {
  user: UserSummary
  /** The signed-in admin, as the list reports them; undefined until it loads. */
  viewer: Party | undefined
  onChanged: (message: string) => void
}

/**
 * The Actions cell: a pencil where the viewer may change this user, a reason
 * where they may not. Decided by the same authorise() the API enforces, so the
 * page never offers what the API would refuse.
 */
export default function UserActions({ user, viewer, onChanged }: Props) {
  const may = (change: Change) => viewer !== undefined && authorise(viewer, user, change).allowed

  const canEdit = may({ editsDetails: true })
  const canSetActive = may({ editsDetails: false, isActive: !user.isActive })

  if (!canEdit) {
    return (
      <span className="text-sm text-muted-foreground">
        {user.isProtected ? 'Protected' : '—'}
        <span className="sr-only">: only the seeded admin can change this account</span>
      </span>
    )
  }

  return (
    <EditUserDialog
      canSetActive={canSetActive}
      isSelf={viewer?.id === user.id}
      onChanged={onChanged}
      user={user}
    />
  )
}
