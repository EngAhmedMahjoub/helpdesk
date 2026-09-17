import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { currentUserQueryKey, login } from '@/lib/auth'

export default function LoginPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const signIn = useMutation({
    mutationFn: login,
    onSuccess: (user) => {
      // Login already answered with the user, so seed the cache with it. The
      // guard on / would otherwise send a second request for what we hold.
      queryClient.setQueryData(currentUserQueryKey, user)
      // replace, so the back button does not land on the login page again.
      void navigate('/', { replace: true })
    },
  })

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

        <form
          onSubmit={(event) => {
            event.preventDefault()
            signIn.mutate({ email, password })
          }}
        >
          <CardContent className="flex flex-col gap-4">
            {signIn.isError && (
              <p className="text-sm text-destructive" role="alert">
                {signIn.error.message}
              </p>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                autoComplete="username"
                id="email"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                autoComplete="current-password"
                id="password"
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </div>
          </CardContent>

          <CardFooter className="mt-6">
            <Button className="w-full" disabled={signIn.isPending} type="submit">
              {signIn.isPending ? 'Signing in…' : 'Sign in'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  )
}
