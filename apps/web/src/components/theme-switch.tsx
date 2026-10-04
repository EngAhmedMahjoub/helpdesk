import { cn } from 'cn'
import { type Theme, useTheme } from '@/hooks/use-theme'

const options: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]

/** Light, Dark or System, for the sidebar's foot. */
export default function ThemeSwitch() {
  const { theme, setTheme } = useTheme()

  return (
    <div aria-label="Theme" className="flex rounded-md bg-sidebar-accent p-0.5" role="group">
      {options.map((option) => (
        <button
          aria-pressed={theme === option.value}
          className={cn(
            'flex-1 rounded-sm px-2 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
            theme === option.value
              ? 'bg-sidebar-primary text-sidebar-primary-foreground'
              : 'text-sidebar-foreground hover:text-sidebar-accent-foreground',
          )}
          key={option.value}
          onClick={() => {
            setTheme(option.value)
          }}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
