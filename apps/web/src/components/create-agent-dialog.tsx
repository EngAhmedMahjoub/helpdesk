import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import type { UserSummary } from '@helpdesk/shared'
import { ButtonSpinner } from '@/components/page-spinner'
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useCreateUser } from '@/hooks/use-users'
import { ApiError } from '@/lib/api'

/**
 * The same limits as the API's createUserSchema, so an admin hears about a short
 * password before the request rather than as a bare 400 after it. The API stays
 * the real validator; this only moves the message earlier.
 */
const createAgentSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(100, 'Keep the name under 100 characters'),
  email: z.email('Enter a valid email address').max(254, 'Use at most 254 characters'),
  password: z
    .string()
    .min(12, 'Use at least 12 characters')
    .max(200, 'Keep the password under 200 characters'),
})

type CreateAgentValues = z.infer<typeof createAgentSchema>

const emptyValues: CreateAgentValues = { name: '', email: '', password: '' }

export default function CreateAgentDialog({
  onCreated,
}: {
  onCreated: (user: UserSummary) => void
}) {
  const [open, setOpen] = useState(false)
  const createUser = useCreateUser()

  const form = useForm<CreateAgentValues>({
    resolver: zodResolver(createAgentSchema),
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

  function submit(values: CreateAgentValues) {
    createUser.mutate(values, {
      onSuccess: (user) => {
        handleOpenChange(false)
        onCreated(user)
      },
      onError: (error) => {
        // Unlike login, naming the field is right here: the admin has to know
        // which value to change, and the API has already said it is the email.
        if (error instanceof ApiError && error.status === 409) {
          form.setError('email', { message: error.message }, { shouldFocus: true })
        }
      },
    })
  }

  const conflict = createUser.error instanceof ApiError && createUser.error.status === 409

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
          {createUser.isError && !conflict && (
            <p className="mb-4 text-sm text-destructive" role="alert">
              {createUser.error.message}
            </p>
          )}

          <FieldGroup>
            <Field data-invalid={Boolean(errors.name)}>
              <FieldLabel htmlFor="agent-name">Name</FieldLabel>
              <Input
                aria-invalid={Boolean(errors.name)}
                autoComplete="off"
                id="agent-name"
                {...form.register('name')}
              />
              <FieldError errors={[errors.name]} />
            </Field>

            <Field data-invalid={Boolean(errors.email)}>
              <FieldLabel htmlFor="agent-email">Email</FieldLabel>
              <Input
                aria-invalid={Boolean(errors.email)}
                // off, so the browser does not offer the admin's own address.
                autoComplete="off"
                id="agent-email"
                type="email"
                {...form.register('email')}
              />
              <FieldError errors={[errors.email]} />
            </Field>

            <Field data-invalid={Boolean(errors.password)}>
              <FieldLabel htmlFor="agent-password">Initial password</FieldLabel>
              <Input
                aria-describedby="agent-password-hint"
                aria-invalid={Boolean(errors.password)}
                // new-password: without it a password manager fills in the
                // admin's own saved password, and the agent is created with it.
                autoComplete="new-password"
                id="agent-password"
                type="password"
                {...form.register('password')}
              />
              <FieldDescription id="agent-password-hint">At least 12 characters.</FieldDescription>
              <FieldError errors={[errors.password]} />
            </Field>
          </FieldGroup>

          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button disabled={createUser.isPending} type="submit">
              {createUser.isPending && <ButtonSpinner />}
              {createUser.isPending ? 'Adding…' : 'Add agent'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
