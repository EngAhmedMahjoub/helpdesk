import {
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

type Props = {
  status: TicketStatus | undefined
  category: TicketCategory | undefined
  sort: SortChoice
  onStatus: (status: TicketStatus | undefined) => void
  onCategory: (category: TicketCategory | undefined) => void
  onSort: (sort: SortChoice) => void
}

export default function TicketFilters({
  status,
  category,
  sort,
  onStatus,
  onCategory,
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
