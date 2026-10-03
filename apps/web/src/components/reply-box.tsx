import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { type CreateReplyRequest, REPLY_MAX_LENGTH, createReplySchema } from '@helpdesk/shared'
import { PendingLabel } from '@/components/page-spinner'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { useCreateReply } from '@/hooks/use-tickets'

/**
 * An agent's reply, saved as an outbound message on the ticket. Phase 4 is
 * what will email it, so the button says what happens today.
 */
export default function ReplyBox({ ticketId, student }: { ticketId: number; student: string }) {
  const sendReply = useCreateReply(ticketId)
  const form = useForm<CreateReplyRequest>({
    // The API's own schema, so a blank or over-long reply is caught here
    // rather than coming back as a bare 400.
    resolver: zodResolver(createReplySchema),
    defaultValues: { body: '' },
  })

  const errors = form.formState.errors

  function submit(values: CreateReplyRequest) {
    sendReply.mutate(values, {
      onSuccess: () => {
        // Only on success: a reply the API refused stays in the box, where its
        // author can try again rather than write it a second time.
        form.reset({ body: '' })
      },
    })
  }

  return (
    <form noValidate onSubmit={form.handleSubmit(submit)}>
      {sendReply.isError && (
        <p className="mb-4 text-sm text-destructive" role="alert">
          {sendReply.error.message}
        </p>
      )}

      <Field data-invalid={Boolean(errors.body)}>
        <FieldLabel htmlFor="reply-body">Reply to {student}</FieldLabel>
        <Textarea
          aria-describedby="reply-hint"
          aria-invalid={Boolean(errors.body)}
          id="reply-body"
          rows={5}
          {...form.register('body')}
        />
        <FieldDescription id="reply-hint">
          Emailed to the student and saved on the ticket. Up to {REPLY_MAX_LENGTH.toLocaleString()}{' '}
          characters.
        </FieldDescription>
        <FieldError errors={[errors.body]} />
      </Field>

      <div className="mt-4 flex items-center gap-4">
        <Button disabled={sendReply.isPending} type="submit">
          <PendingLabel busy="Sending…" pending={sendReply.isPending}>
            Send reply
          </PendingLabel>
        </Button>

        {/* Always rendered: a live region added and filled at once is announced
            by neither of the two most common screen readers. */}
        <p aria-live="polite" className="text-sm text-muted-foreground" role="status">
          {sendReply.isSuccess ? 'Reply added to the thread.' : ''}
        </p>
      </div>
    </form>
  )
}
