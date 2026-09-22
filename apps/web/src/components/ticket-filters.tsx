import {
  type ListTicketsQuery,
  type TicketCategory,
  type TicketStatus,
  TICKET_CATEGORIES,
  TICKET_STATUSES,
} from '@helpdesk/shared'
import SelectField from '@/components/select-field'
import { SelectItem } from '@/components/ui/select'

/** The sort and its direction as one choice, because they are one control. */
export type SortChoice = `${'createdAt' | 'updatedAt'}:${'asc' | 'desc'}`

const sortLabels: Record<SortChoice, string> = {
  'updatedAt:desc': 'Latest activity',
  'updatedAt:asc': 'Oldest activity',
  'createdAt:desc': 'Newest ticket',
  'createdAt:asc': 'Oldest ticket',
}

// Radix has no value for "no choice", and an empty string is not allowed, so
// the All options carry their own value and are mapped back to undefined.
const ALL = 'all'

type AssigneeFilter = ListTicketsQuery['assignee']

/** Whose tickets, in words: the API takes "me" and "none", not a person. */
const assigneeLabels: Record<NonNullable<AssigneeFilter>, string> = {
  me: 'Assigned to me',
  none: 'Unassigned',
}

type Props = {
  status: TicketStatus | undefined
  category: TicketCategory | undefined
  assignee: AssigneeFilter
  sort: SortChoice
  onStatus: (status: TicketStatus | undefined) => void
  onCategory: (category: TicketCategory | undefined) => void
  onAssignee: (assignee: AssigneeFilter) => void
  onSort: (sort: SortChoice) => void
}

export default function TicketFilters({
  status,
  category,
  assignee,
  sort,
  onStatus,
  onCategory,
  onAssignee,
  onSort,
}: Props) {
  return (
    <div className="mt-6 flex flex-wrap items-end gap-4">
      <Filter
        id="filter-status"
        label="Status"
        onChange={(value) => {
          onStatus(value === ALL ? undefined : (value as TicketStatus))
        }}
        options={TICKET_STATUSES}
        value={status ?? ALL}
      />

      <Filter
        id="filter-category"
        label="Category"
        onChange={(value) => {
          onCategory(value === ALL ? undefined : (value as TicketCategory))
        }}
        options={TICKET_CATEGORIES}
        value={category ?? ALL}
      />

      <SelectField
        className="w-44"
        id="filter-assignee"
        label="Assignee"
        onChange={(value) => {
          onAssignee(value === ALL ? undefined : (value as NonNullable<AssigneeFilter>))
        }}
        value={assignee ?? ALL}
      >
        {/* Anyone rather than All: it reads as a person, which this filter is about. */}
        <SelectItem value={ALL}>Anyone</SelectItem>
        {Object.entries(assigneeLabels).map(([value, label]) => (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        ))}
      </SelectField>

      <SelectField
        className="w-48"
        id="filter-sort"
        label="Sort by"
        onChange={(value) => {
          onSort(value as SortChoice)
        }}
        value={sort}
      >
        {Object.entries(sortLabels).map(([value, label]) => (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        ))}
      </SelectField>
    </div>
  )
}

function Filter({
  id,
  label,
  options,
  value,
  onChange,
}: {
  id: string
  label: string
  options: readonly string[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <SelectField id={id} label={label} onChange={onChange} value={value}>
      <SelectItem value={ALL}>All</SelectItem>
      {options.map((option) => (
        <SelectItem className="capitalize" key={option} value={option}>
          {option}
        </SelectItem>
      ))}
    </SelectField>
  )
}
