import type { UserSummary } from '@helpdesk/shared'
import TableSkeleton, { type Column } from '@/components/table-skeleton'
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

// One list for the skeleton and the table, so their headers and widths cannot
// drift apart. Sums to 100%; Email gets the most because it runs longest.
const columns: Column[] = [
  { label: 'Name', width: 'w-[22%]' },
  { label: 'Email', width: 'w-[32%]' },
  { label: 'Role', width: 'w-[13%]' },
  { label: 'Status', width: 'w-[15%]' },
  { label: 'Joined', width: 'w-[18%]' },
]

export default function UsersPage() {
  const users = useUsers()

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold text-foreground">Users</h1>
      <p className="mt-2 text-muted-foreground">
        Everyone who can sign in to the helpdesk, oldest first.
      </p>

      <div className="mt-6">
        {users.isPending && <TableSkeleton columns={columns} label="Loading users" />}

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
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
