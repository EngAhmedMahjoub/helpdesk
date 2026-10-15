import { PendingLabel } from '@/components/page-spinner'
import { Button } from '@/components/ui/button'
import type { usePolish } from '@/hooks/use-polish'

/**
 * The Polish button, and Undo once a polish has replaced the text. Beside the
 * send control, never in place of it: nothing polished is sent until the
 * agent has read it and sends it themselves.
 */
export function PolishControl({
  polish,
  disabled = false,
}: {
  polish: ReturnType<typeof usePolish>
  /** The form is sending, approving or rejecting. */
  disabled?: boolean
}) {
  return (
    <>
      <Button
        disabled={disabled || !polish.canPolish}
        onClick={polish.polish}
        type="button"
        variant="outline"
      >
        <PendingLabel busy="Polishing…" pending={polish.isPending}>
          Polish
        </PendingLabel>
      </Button>
      {polish.canUndo && (
        <Button disabled={disabled} onClick={polish.undo} type="button" variant="ghost">
          Undo polish
        </Button>
      )}
    </>
  )
}

/** Why the last polish did not happen, beside the controls. */
export function PolishError({ polish }: { polish: ReturnType<typeof usePolish> }) {
  return polish.error ? (
    <p className="mt-2 text-sm text-destructive" role="alert">
      {polish.error}
    </p>
  ) : null
}
