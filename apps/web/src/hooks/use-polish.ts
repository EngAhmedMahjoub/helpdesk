import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { UseFormReturn } from 'react-hook-form'
import { polishRequestSchema } from '@helpdesk/shared'
import { polishText } from '@/lib/ai'

/**
 * Polish (#323) for a form whose text lives in `body`: the reply box and the
 * draft review alike.
 *
 * Undo is offered while the box still holds exactly what Claude returned. Any
 * edit, or a send that empties the box, takes it away without a flag to clear:
 * the agent's next keystroke is their own text, and putting back an older one
 * over it would lose that.
 */
export function usePolish(form: UseFormReturn<{ body: string }>) {
  const [last, setLast] = useState<{ original: string; polished: string } | null>(null)
  const [tooLong, setTooLong] = useState<string | null>(null)
  const body = form.watch('body')

  const mutation = useMutation({
    mutationFn: polishText,
    onSuccess: ({ text }, { text: sent }) => {
      setLast({ original: sent, polished: text })
      form.setValue('body', text, { shouldDirty: true, shouldValidate: true })
    },
  })

  function polish() {
    setTooLong(null)
    // The API's own rule, so an over-long text is named here rather than
    // coming back as a bare 400 after a round trip.
    const parsed = polishRequestSchema.safeParse({ text: body })
    if (!parsed.success) {
      setTooLong(parsed.error.issues[0]?.message ?? 'This text cannot be polished')
      return
    }
    mutation.mutate({ text: body })
  }

  function undo() {
    if (!last) return
    form.setValue('body', last.original, { shouldDirty: true, shouldValidate: true })
    setLast(null)
  }

  return {
    polish,
    undo,
    canPolish: body.trim() !== '' && !mutation.isPending,
    canUndo: last !== null && body === last.polished,
    isPending: mutation.isPending,
    error: tooLong ?? (mutation.isError ? mutation.error.message : null),
  }
}
