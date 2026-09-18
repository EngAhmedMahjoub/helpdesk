import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router'
import { type LoginRequest, loginSchema } from '@helpdesk/shared'
import { ButtonSpinner } from '@/components/page-spinner'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { currentUserQueryKey, login } from '@/lib/auth'

export default function LoginPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const form = useForm<LoginRequest>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  const signIn = useMutation({
    mutationFn: login,
    onSuccess: (user) => {
      // Whatever is cached belongs to whoever was here before. Sign-out and a
      // 401 already clear it, but a session that simply expired is only noticed
      // by the /auth/me check, which answers null rather than failing, so
      // nothing clears the cache that way. Clearing here covers every route in.
      queryClient.clear()
      // Login already answered with the user, so seed the cache with it. The
      // guard on / would otherwise send a second request for what we hold.
      queryClient.setQueryData(currentUserQueryKey, user)
      // replace, so the back button does not land on the login page again.
      void navigate('/', { replace: true })
    },
  })

  const errors = form.formState.errors

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          {/* CardTitle renders a div; the ARIA role gives the page a real heading. */}
          <CardTitle aria-level={1} role="heading">
            Sign in
          </CardTitle>
          <CardDescription>Helpdesk accounts are created by an administrator.</CardDescription>
        </CardHeader>

        {/* noValidate hands validation to the schema, so the messages a visitor
            reads are ours rather than the browser's own bubbles. */}
        <form noValidate onSubmit={form.handleSubmit((values) => signIn.mutate(values))}>
          <CardContent>
            {signIn.isError && (
              <p className="mb-4 text-sm text-destructive" role="alert">
                {signIn.error.message}
              </p>
            )}

            <FieldGroup>
              <Field data-invalid={Boolean(errors.email)}>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  aria-invalid={Boolean(errors.email)}
                  autoComplete="username"
                  id="email"
                  type="email"
                  {...form.register('email')}
                />
                <FieldError errors={[errors.email]} />
              </Field>

              <Field data-invalid={Boolean(errors.password)}>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  aria-invalid={Boolean(errors.password)}
                  autoComplete="current-password"
                  id="password"
                  type="password"
                  {...form.register('password')}
                />
                <FieldError errors={[errors.password]} />
              </Field>
            </FieldGroup>
          </CardContent>

          <CardFooter className="mt-6">
            <Button className="w-full" disabled={signIn.isPending} type="submit">
              {signIn.isPending && <ButtonSpinner />}
              {signIn.isPending ? 'Signing in…' : 'Sign in'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  )
}
