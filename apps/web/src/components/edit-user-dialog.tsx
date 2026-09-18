import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Pencil } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import {
  type Change,
  type Party,
  type UpdateUserRequest,
  type UserSummary,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  authorise,
  emailField,
  nameField,
} from '@helpdesk/shared'
import { FormAlert, FormField } from '@/components/form-field'
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
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { FieldGroup } from '@/components/ui/field'
import { Separator } from '@/components/ui/separator'
import { useUpdateUser } from '@/hooks/use-users'
import { isApiError } from '@/lib/api'

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

const detailsSchema = z.object({
  name: nameField,
  email: emailField,
  // Blank keeps the current password; anything else meets the API's limits. Not
  // passwordField.or(''): a union reports its own message, not the minimum's.
  password: z
    .string()
    .max(PASSWORD_MAX_LENGTH, `Keep the password under ${PASSWORD_MAX_LENGTH} characters`)
    .refine(
      (value) => value === '' || value.length >= PASSWORD_MIN_LENGTH,
      `Use at least ${PASSWORD_MIN_LENGTH} characters`,
    ),
})

type DetailsValues = z.infer<typeof detailsSchema>

function EditUserDialog({
  user,
  isSelf,
  canSetActive,
  onChanged,
}: {
  user: UserSummary
  isSelf: boolean
  canSetActive: boolean
  onChanged: (message: string) => void
}) {
  const [open, setOpen] = useState(false)
  // Two, so a failed save and a failed deactivation each show beside their own
  // button instead of one error appearing in both places.
  const saveDetails = useUpdateUser()
  const setAccess = useUpdateUser()

  const initial: DetailsValues = { name: user.name, email: user.email, password: '' }
  const form = useForm<DetailsValues>({
    resolver: zodResolver(detailsSchema),
    defaultValues: initial,
  })
  const errors = form.formState.errors

  // Every opening starts from the user as the list has them now, and every
  // closing forgets what was typed: a half-typed password must not wait in a
  // closed dialog for the next person at this screen.
  function handleOpenChange(next: boolean) {
    setOpen(next)
    form.reset(initial)
    saveDetails.reset()
    setAccess.reset()
  }

  function save(values: DetailsValues) {
    // Only what changed goes to the API. An untouched email would otherwise be
    // re-sent, and a blank password must never be.
    const changes: UpdateUserRequest = {}
    if (values.name !== user.name) changes.name = values.name
    if (values.email.toLowerCase() !== user.email) changes.email = values.email
    if (values.password !== '') changes.password = values.password

    if (Object.keys(changes).length === 0) {
      handleOpenChange(false)
      return
    }

    saveDetails.mutate(
      { id: user.id, changes },
      {
        onSuccess: (updated) => {
          handleOpenChange(false)
          const signedOut =
            changes.password === undefined
              ? ''
              : isSelf
                ? ' Your other sessions were signed out.'
                : ' They were signed out and must use the new password.'
          onChanged(`${updated.name} was updated.${signedOut}`)
        },
        onError: (error) => {
          if (isApiError(error, 409)) {
            form.setError('email', { message: error.message }, { shouldFocus: true })
          }
        },
      },
    )
  }

  function changeAccess(isActive: boolean) {
    setAccess.mutate(
      { id: user.id, changes: { isActive } },
      {
        onSuccess: () => {
          handleOpenChange(false)
          onChanged(
            isActive
              ? `${user.name} was reactivated and can sign in again.`
              : `${user.name} was deactivated and signed out.`,
          )
        },
      },
    )
  }

  const conflict = isApiError(saveDetails.error, 409)

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogTrigger asChild>
        {/* Named for its row: every row's pencil looks the same, and a screen
            reader listing the page's buttons would otherwise offer ten "Edit"s. */}
        <Button aria-label={`Edit ${user.name}`} size="icon-sm" variant="ghost">
          <Pencil aria-hidden />
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {user.name}</DialogTitle>
          <DialogDescription>
            A new password signs {isSelf ? 'your other sessions' : 'them'} out everywhere.
          </DialogDescription>
        </DialogHeader>

        <form id={`edit-user-${user.id}`} noValidate onSubmit={form.handleSubmit(save)}>
          {saveDetails.isError && !conflict && <FormAlert>{saveDetails.error.message}</FormAlert>}

          <FieldGroup>
            <FormField
              autoComplete="off"
              error={errors.name}
              id={`edit-name-${user.id}`}
              label="Name"
              {...form.register('name')}
            />

            <FormField
              autoComplete="off"
              error={errors.email}
              id={`edit-email-${user.id}`}
              label="Email"
              type="email"
              {...form.register('email')}
            />

            <FormField
              // new-password: without it a password manager fills in the
              // admin's own saved password, and the user is given it.
              autoComplete="new-password"
              description={`Leave blank to keep the current password. At least ${PASSWORD_MIN_LENGTH} characters.`}
              error={errors.password}
              id={`edit-password-${user.id}`}
              label="New password"
              type="password"
              {...form.register('password')}
            />
          </FieldGroup>
        </form>

        <Separator />

        {/* Outside the form, so its buttons act on their own and cannot submit
            the details by accident; above the footer, which shadcn styles as
            the dialog's closing bar. */}
        <section aria-labelledby={`access-${user.id}`} className="flex flex-col gap-2">
          <h3 className="text-sm font-medium" id={`access-${user.id}`}>
            Access
          </h3>
          <AccessControl
            canSetActive={canSetActive}
            isSelf={isSelf}
            onChange={changeAccess}
            setAccess={setAccess}
            user={user}
          />
        </section>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          {/* form=, because the footer sits outside the form it submits. */}
          <Button disabled={saveDetails.isPending} form={`edit-user-${user.id}`} type="submit">
            <PendingLabel busy="Saving…" pending={saveDetails.isPending}>
              Save changes
            </PendingLabel>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Deactivation keeps its confirmation, because it cannot be quietly undone:
 * reactivating restores the account, but the sessions it ended stay ended.
 * Reactivation only gives back access and asks nothing.
 */
function AccessControl({
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
