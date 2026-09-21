import type { TicketListResponse } from '@helpdesk/shared'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// The sizes an agent picks between. Each is within the API's cap of 100.
const PAGE_SIZES = [5, 10, 20, 50] as const

export default function TicketPagination({
  data,
  onPage,
  onPageSize,
}: {
  data: TicketListResponse
  onPage: (page: number) => void
  onPageSize: (pageSize: number) => void
}) {
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize))
  const first = (data.page - 1) * data.pageSize + 1
  const last = first + data.tickets.length - 1

  return (
    <nav aria-label="Pagination" className="mt-6 flex items-center justify-between gap-4">
      {/* A live region: the numbers change without the page moving, and the
          buttons that changed them keep focus, so nothing else announces it. */}
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {data.tickets.length === 0
          ? `No tickets on page ${String(data.page)} of ${String(data.total)}`
          : `Showing ${String(first)}–${String(last)} of ${String(data.total)}`}
      </p>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Label className="text-sm font-normal text-muted-foreground" htmlFor="rows-per-page">
            Rows per page
          </Label>
          <Select
            onValueChange={(value) => {
              onPageSize(Number(value))
            }}
            value={String(data.pageSize)}
          >
            <SelectTrigger className="w-20" id="rows-per-page" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* The API's own page size, when it is not one of the choices —
                  a hand-typed ?pageSize=7 would otherwise show an empty box. */}
              {[...new Set([...PAGE_SIZES, data.pageSize])]
                .sort((a, b) => a - b)
                .map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Button
            disabled={data.page <= 1}
            onClick={() => {
              onPage(data.page - 1)
            }}
            size="sm"
            variant="outline"
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {data.page} of {pages}
          </span>
          <Button
            disabled={data.page >= pages}
            onClick={() => {
              onPage(data.page + 1)
            }}
            size="sm"
            variant="outline"
          >
            Next
          </Button>
        </div>
      </div>
    </nav>
  )
}
