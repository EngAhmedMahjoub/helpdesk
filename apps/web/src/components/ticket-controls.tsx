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
import SelectField from '@/components/select-field'
import { SelectItem } from '@/components/ui/select'
import { useCurrentUser } from '@/hooks/use-auth'
import { useAssignees, useUpdateTicket } from '@/hooks/use-tickets'
import { escalationReasonLabels } from '@/lib/escalation'

/**
 * Stands in for a null category, so the select always has a value. Given
 * `undefined` Radix reads the select as uncontrolled and the trigger keeps
 * whatever was last clicked — showing a classification the API may have
 * refused. It is offered as a disabled option: a ticket can be classified,
 * but the API takes nothing back to unclassified.
 */
const UNCLASSIFIED = 'unclassified'

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
          // Only while it has no category: once classified there is no way back.
          unsetOption={ticket.category === null ? UNCLASSIFIED : undefined}
          value={ticket.category ?? UNCLASSIFIED}
        />

        <AssigneeControl
          disabled={update.isPending}
          onAssign={(assigneeId) => {
            update.mutate({ assigneeId })
          }}
          ticket={ticket}
        />

        {ticket.needsAgent && (
          <div className="flex items-center gap-2">
            <Badge variant="destructive">
              Needs agent
              {ticket.escalationReason
                ? `: ${escalationReasonLabels[ticket.escalationReason]}`
                : ''}
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

/**
 * Stands in for no assignee, for the same reason UNCLASSIFIED stands in for
 * no category. Unlike it, choosing it is allowed: a ticket can be handed back.
 * No user id can collide with it, since every id is a UUID.
 */
const UNASSIGNED = 'unassigned'

/**
 * Who holds the ticket, and a shortcut for taking it. The choices are the
 * active users the API would accept, so a deactivated one is never offered.
 */
function AssigneeControl({
  ticket,
  disabled,
  onAssign,
}: {
  ticket: TicketDetail
  disabled: boolean
  onAssign: (assigneeId: string | null) => void
}) {
  const assignees = useAssignees()
  const me = useCurrentUser().data
  const current = ticket.assignee

  // The assignee is kept in the choices even when the list lacks them — not
  // loaded yet, or deactivated since — so the trigger always names who holds it.
  const choices = assignees.data ?? []
  const options =
    current && !choices.some((each) => each.id === current.id) ? [current, ...choices] : choices

  return (
    <div className="flex items-end gap-2">
      <SelectField
        className="w-48"
        disabled={disabled}
        id={`assignee-${String(ticket.id)}`}
        label="Assignee"
        onChange={(value) => {
          onAssign(value === UNASSIGNED ? null : value)
        }}
        value={current?.id ?? UNASSIGNED}
      >
        <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
        {options.map((each) => (
          <SelectItem key={each.id} value={each.id}>
            {each.name}
          </SelectItem>
        ))}
      </SelectField>

      {me && current?.id !== me.id && (
        <Button
          disabled={disabled}
          onClick={() => {
            onAssign(me.id)
          }}
          variant="outline"
        >
          Assign to me
        </Button>
      )}
    </div>
  )
}

function Field({
  id,
  label,
  options,
  value,
  unsetOption,
  disabled,
  onChange,
}: {
  id: string
  label: string
  options: readonly string[]
  value: string
  /** A value the select may show but nobody may choose. */
  unsetOption?: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <SelectField
      className="w-40 capitalize"
      disabled={disabled}
      id={id}
      label={label}
      onChange={onChange}
      value={value}
    >
      {unsetOption && (
        // Rendered so the trigger has something to show, disabled so the
        // value it stands for cannot be chosen.
        <SelectItem className="capitalize" disabled value={unsetOption}>
          {unsetOption}
        </SelectItem>
      )}
      {options.map((option) => (
        <SelectItem className="capitalize" key={option} value={option}>
          {option}
        </SelectItem>
      ))}
    </SelectField>
  )
}
