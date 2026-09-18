import type { UserSummary } from '@helpdesk/shared'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useUsers } from '@/hooks/use-users'

// Built once rather than per row. undefined locale means the reader's own.
const joinedFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

export default function UsersPage() {
  const users = useUsers()

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold text-foreground">Users</h1>
      <p className="mt-2 text-muted-foreground">
        Everyone who can sign in to the helpdesk, oldest first.
      </p>

      <div className="mt-6">
        {users.isPending && <p className="text-muted-foreground">Loading users…</p>}

        {users.isError && (
          <p className="text-destructive" role="alert">
            {users.error.message}
          </p>
        )}

        {users.data && <UsersTable users={users.data} />}
      </div>
    </main>
  )
}

function UsersTable({ users }: { users: UserSummary[] }) {
  return (
    <Table>
      <caption className="sr-only">Users, oldest first</caption>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Joined</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((user) => (
          <TableRow key={user.id}>
            <TableCell className="font-medium text-foreground">{user.name}</TableCell>
            <TableCell className="text-muted-foreground">{user.email}</TableCell>
            <TableCell>
              <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>{user.role}</Badge>
            </TableCell>
            <TableCell>
              {/* The word carries the meaning; the colour only seconds it, so a
                  reader who cannot tell the two badges apart loses nothing. */}
              <Badge variant={user.isActive ? 'outline' : 'destructive'}>
                {user.isActive ? 'Active' : 'Deactivated'}
              </Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">
              <time dateTime={user.createdAt}>{joinedFormat.format(new Date(user.createdAt))}</time>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
