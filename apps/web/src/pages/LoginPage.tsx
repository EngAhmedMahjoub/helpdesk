import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router'
import { type LoginRequest, loginSchema } from '@helpdesk/shared'
import { FormAlert, FormField } from '@/components/form-field'
import { PendingLabel } from '@/components/page-spinner'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { FieldGroup } from '@/components/ui/field'
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
            {signIn.isError && <FormAlert>{signIn.error.message}</FormAlert>}

            <FieldGroup>
              <FormField
                autoComplete="username"
                error={errors.email}
                id="email"
                label="Email"
                type="email"
                {...form.register('email')}
              />

              <FormField
                autoComplete="current-password"
                error={errors.password}
                id="password"
                label="Password"
                type="password"
                {...form.register('password')}
              />
            </FieldGroup>
          </CardContent>

          <CardFooter className="mt-6">
            <Button className="w-full" disabled={signIn.isPending} type="submit">
              <PendingLabel busy="Signing in…" pending={signIn.isPending}>
                Sign in
              </PendingLabel>
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  )
}
