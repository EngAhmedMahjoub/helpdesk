import { LoaderCircle } from 'lucide-react'

/** Fills the viewport while a screen decides what it has to show. */
export default function PageSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex min-h-svh items-center justify-center" role="status">
      <LoaderCircle aria-hidden className="size-6 animate-spin text-muted-foreground" />
      <span className="sr-only">{label}</span>
    </div>
  )
}

/**
 * Sits inside a button while its action is in flight. No role or label of its
 * own: the button's text already changes to say what is happening, and a second
 * announcement would only talk over it.
 */
export function ButtonSpinner() {
  return <LoaderCircle aria-hidden className="size-4 animate-spin" />
}
