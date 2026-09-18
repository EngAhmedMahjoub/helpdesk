import { useState } from 'react'
import type { UserSummary } from '@helpdesk/shared'
import CreateAgentDialog from '@/components/create-agent-dialog'
import TableSkeleton, { type Column } from '@/components/table-skeleton'
import UserActions from '@/components/user-actions'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useCurrentUser } from '@/hooks/use-auth'
import { useUsers } from '@/hooks/use-users'

// Built once rather than per row. undefined locale means the reader's own.
const joinedFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

// One list for the skeleton and the table, so their headers and widths cannot
// drift apart. Sums to 100%; Email gets the most because it runs longest.
const columns: Column[] = [
  { label: 'Name', width: 'w-[19%]' },
  { label: 'Email', width: 'w-[27%]' },
  { label: 'Role', width: 'w-[10%]' },
  { label: 'Status', width: 'w-[13%]' },
  { label: 'Joined', width: 'w-[15%]' },
  { label: 'Actions', width: 'w-[16%]' },
]

export default function UsersPage() {
  const users = useUsers()
  const currentUser = useCurrentUser()
  const [announcement, setAnnouncement] = useState('')

  return (
    <main className="mx-auto max-w-5xl p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Users</h1>
          <p className="mt-2 text-muted-foreground">
            Everyone who can sign in to the helpdesk, oldest first.
          </p>
        </div>
        <CreateAgentDialog
          onCreated={(user) => setAnnouncement(`${user.name} was added and can sign in now.`)}
        />
      </div>

      {/* Closing the dialog returns focus to its button and says nothing, so a
          screen reader user would not know it worked. The row it adds lands at
          the bottom of a list they may not be reading. Always rendered, even
          empty: a live region hidden until its text arrives is added and filled
          at once, and most screen readers announce neither. */}
      <p aria-live="polite" className="mt-4 text-sm text-muted-foreground" role="status">
        {announcement}
      </p>

      <div className="mt-6">
        {users.isPending && <TableSkeleton columns={columns} label="Loading users" />}

        {users.isError && (
          <p className="text-destructive" role="alert">
            {users.error.message}
          </p>
        )}

        {users.data && (
          <UsersTable
            currentUserId={currentUser.data?.id}
            onChanged={setAnnouncement}
            users={users.data}
          />
        )}
      </div>
    </main>
  )
}

function UsersTable({
  users,
  currentUserId,
  onChanged,
}: {
  users: UserSummary[]
  currentUserId: string | undefined
  onChanged: (message: string) => void
}) {
  // The signed-in admin's own row: /auth/me does not say whether they are the
  // seeded admin, and the list does.
  const viewer = users.find((user) => user.id === currentUserId)

  return (
    <Table className="table-fixed">
      <caption className="sr-only">Users, oldest first</caption>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead className={column.width} key={column.label}>
              {column.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((user) => (
          <TableRow key={user.id}>
            {/* Fixed columns cut long text off instead of widening to fit it;
                title keeps the whole value a hover away. */}
            <TableCell className="truncate font-medium text-foreground" title={user.name}>
              {user.name}
            </TableCell>
            <TableCell className="truncate text-muted-foreground" title={user.email}>
              {user.email}
            </TableCell>
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
            <TableCell>
              <UserActions onChanged={onChanged} user={user} viewer={viewer} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
