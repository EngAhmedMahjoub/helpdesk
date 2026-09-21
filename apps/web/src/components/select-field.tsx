import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'

/**
 * A labelled select. The shell only — the options are the caller's, because
 * what a select offers is where these differ: the list's filters carry an
 * "All" that maps back to no filter, and the ticket's category carries a
 * disabled "unclassified" it can leave but never return to.
 */
export default function SelectField({
  id,
  label,
  value,
  onChange,
  disabled,
  className = 'w-40',
  children,
}: {
  id: string
  label: string
  /** Never undefined: Radix reads that as uncontrolled and keeps its own state. */
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  /** The trigger's width, since these sit in rows of differing widths. */
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select disabled={disabled} onValueChange={onChange} value={value}>
        <SelectTrigger className={className} id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </div>
  )
}
