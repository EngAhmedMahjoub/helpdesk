import {
  type TicketCategory,
  type TicketDetail,
  type TicketStatus,
  TICKET_CATEGORIES,
  TICKET_STATUSES,
} from '@helpdesk/shared'
import { PendingLabel } from '@/components/page-spinner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useUpdateTicket } from '@/hooks/use-tickets'

const escalationReasons = {
  refund_approval: 'refund approval',
  ai_failed: 'AI could not answer',
} as const

/**
 * The status and category an agent can change, in place of the badges that
 * only reported them. One mutation behind all three controls: the API answers
 * with the whole ticket, so whichever changed, the rest stay as it says.
 */
export default function TicketControls({ ticket }: { ticket: TicketDetail }) {
  const update = useUpdateTicket(ticket.id)

  return (
    <div className="mt-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-4">
        <Field
          disabled={update.isPending}
          id={`status-${String(ticket.id)}`}
          label="Status"
          onChange={(value) => {
            update.mutate({ status: value as TicketStatus })
          }}
          options={TICKET_STATUSES}
          value={ticket.status}
        />

        <Field
          disabled={update.isPending}
          id={`category-${String(ticket.id)}`}
          label="Category"
          onChange={(value) => {
            update.mutate({ category: value as TicketCategory })
          }}
          options={TICKET_CATEGORIES}
          // Null until the AI or an agent classifies it. The API takes no null
          // back, so "unclassified" is a placeholder rather than an option:
          // a ticket can be classified, not un-classified.
          placeholder="unclassified"
          value={ticket.category ?? undefined}
        />

        {ticket.needsAgent && (
          <div className="flex items-center gap-2">
            <Badge variant="destructive">
              Needs agent
              {ticket.escalationReason ? `: ${escalationReasons[ticket.escalationReason]}` : ''}
            </Badge>
            <Button
              disabled={update.isPending}
              onClick={() => {
                update.mutate({ needsAgent: false })
              }}
              size="sm"
              variant="outline"
            >
              <PendingLabel busy="Clearing…" pending={update.isPending}>
                Clear
              </PendingLabel>
            </Button>
          </div>
        )}
      </div>

      {update.isError && (
        <p className="text-sm text-destructive" role="alert">
          {update.error.message}
        </p>
      )}

      {/* Always rendered: a live region added and filled at once is announced
          by neither of the two most common screen readers. */}
      <p aria-live="polite" className="sr-only" role="status">
        {update.isSuccess
          ? `Ticket updated: ${ticket.status}, ${ticket.category ?? 'unclassified'}.`
          : ''}
      </p>
    </div>
  )
}

function Field({
  id,
  label,
  options,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  id: string
  label: string
  options: readonly string[]
  value: string | undefined
  placeholder?: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select disabled={disabled} onValueChange={onChange} value={value}>
        <SelectTrigger className="w-40 capitalize" id={id}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem className="capitalize" key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
