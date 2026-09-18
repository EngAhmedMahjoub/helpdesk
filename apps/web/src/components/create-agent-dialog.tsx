import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import {
  type CreateUserRequest,
  type UserSummary,
  PASSWORD_MIN_LENGTH,
  createUserSchema,
} from '@helpdesk/shared'
import { FormAlert, FormField } from '@/components/form-field'
import { PendingLabel } from '@/components/page-spinner'
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
import { useCreateUser } from '@/hooks/use-users'
import { isApiError } from '@/lib/api'

const emptyValues: CreateUserRequest = { name: '', email: '', password: '' }

export default function CreateAgentDialog({
  onCreated,
}: {
  onCreated: (user: UserSummary) => void
}) {
  const [open, setOpen] = useState(false)
  const createUser = useCreateUser()

  const form = useForm<CreateUserRequest>({
    // The API's own schema, so an admin hears about a short password before the
    // request rather than as a bare 400 after it. The API stays the real
    // validator; this only moves the message earlier.
    resolver: zodResolver(createUserSchema),
    defaultValues: emptyValues,
  })

  const errors = form.formState.errors

  // Closing by any route — Cancel, the X, Escape, a click outside — starts the
  // next opening clean. A half-typed password left in a closed dialog is one
  // the next admin at this screen would find waiting for them.
  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      form.reset(emptyValues)
      createUser.reset()
    }
  }

  function submit(values: CreateUserRequest) {
    createUser.mutate(values, {
      onSuccess: (user) => {
        handleOpenChange(false)
        onCreated(user)
      },
      onError: (error) => {
        // Unlike login, naming the field is right here: the admin has to know
        // which value to change, and the API has already said it is the email.
        if (isApiError(error, 409)) {
          form.setError('email', { message: error.message }, { shouldFocus: true })
        }
      },
    })
  }

  const conflict = isApiError(createUser.error, 409)

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogTrigger asChild>
        <Button>Add agent</Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add agent</DialogTitle>
          <DialogDescription>
            They sign in with this email and password. Share the password with them yourself;
            nothing is emailed.
          </DialogDescription>
        </DialogHeader>

        {/* noValidate hands validation to the schema, so the messages an admin
            reads are ours rather than the browser's own bubbles. */}
        <form noValidate onSubmit={form.handleSubmit(submit)}>
          {/* A conflict is shown on the email field instead; anything else has
              no field to hang on. */}
          {createUser.isError && !conflict && <FormAlert>{createUser.error.message}</FormAlert>}

          <FieldGroup>
            <FormField
              autoComplete="off"
              error={errors.name}
              id="agent-name"
              label="Name"
              {...form.register('name')}
            />

            <FormField
              // off, so the browser does not offer the admin's own address.
              autoComplete="off"
              error={errors.email}
              id="agent-email"
              label="Email"
              type="email"
              {...form.register('email')}
            />

            <FormField
              // new-password: without it a password manager fills in the
              // admin's own saved password, and the agent is created with it.
              autoComplete="new-password"
              description={`At least ${PASSWORD_MIN_LENGTH} characters.`}
              error={errors.password}
              id="agent-password"
              label="Initial password"
              type="password"
              {...form.register('password')}
            />
          </FieldGroup>

          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button disabled={createUser.isPending} type="submit">
              <PendingLabel busy="Adding…" pending={createUser.isPending}>
                Add agent
              </PendingLabel>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
