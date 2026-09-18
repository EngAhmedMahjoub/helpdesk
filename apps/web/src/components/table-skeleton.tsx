import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

/**
 * A column both the skeleton and the real table are built from. `width` is a
 * Tailwind width class; with `table-fixed` on both, it is what pins the columns
 * in place across the swap. Left to auto layout, widths followed the content,
 * and Role jumped ~90px sideways the moment the data landed.
 */
export type Column = {
  label: string
  width: string
}

type TableSkeletonProps = {
  columns: Column[]
  /** Announced to screen readers in place of the pulsing bars they cannot see. */
  label: string
  rows?: number
}

// Varied widths so the placeholder reads as rows of text, not a grid of bricks.
const barWidths = ['w-3/4', 'w-1/2', 'w-2/3', 'w-5/12']

/** Stands in for a table while its query is pending. */
export default function TableSkeleton({ columns, label, rows = 5 }: TableSkeletonProps) {
  return (
    <div aria-busy="true" role="status">
      <span className="sr-only">{label}</span>
      {/* Hidden from assistive tech: a table of empty cells would be read out
          row by row, and the status above already says what is happening. */}
      <Table aria-hidden="true" className="table-fixed">
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
          {Array.from({ length: rows }, (_, row) => (
            <TableRow key={row}>
              {columns.map((column, cell) => (
                <TableCell key={column.label}>
                  {/* h-5 matches a badge, the tallest thing a real row holds,
                      which keeps rows within a pixel of their loaded height —
                      the badge's inline baseline adds the last one. */}
                  <Skeleton className={`h-5 ${barWidths[(row + cell) % barWidths.length]}`} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
