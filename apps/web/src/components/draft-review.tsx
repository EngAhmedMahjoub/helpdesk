import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import {
  type PendingDraft,
  REPLY_MAX_LENGTH,
  type TicketDetail,
  approveDraftSchema,
} from '@helpdesk/shared'
import { PendingLabel } from '@/components/page-spinner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { useApproveDraft, useRejectDraft } from '@/hooks/use-drafts'

// The API's own rule for an approved body, made required: the box always
// holds the text that will be sent, so an emptied box is an error here rather
// than a quiet fallback to the AI's original. The version travels beside it.
const reviewSchema = approveDraftSchema.pick({ body: true }).required()
type Review = { body: string }

/**
 * The AI's draft reply for an agent to edit, then approve or reject (6.6).
 * Always rendered, so its announcement survives the draft going away: once
 * reviewed the ticket is refetched without one, and the panel with it.
 */
export default function DraftReview({
  ticket,
  student,
}: {
  ticket: TicketDetail
  student: string
}) {
  const approve = useApproveDraft(ticket.id)
  const reject = useRejectDraft(ticket.id)
  const draft = ticket.pendingDraft

  return (
    <>
      {draft && (
        // Keyed by the draft and its version, so a draft the AI rewrote resets
        // the box to the new text rather than leaving the old one to approve.
        <DraftForm
          approve={approve}
          draft={draft}
          key={`${String(draft.id)}:${draft.updatedAt}`}
          reject={reject}
          senderVerified={ticket.senderVerified}
          student={student}
        />
      )}

      {/* Always rendered: a live region added and filled at once is announced
          by neither of the two most common screen readers. */}
      <p aria-live="polite" className="sr-only" role="status">
        {approve.isSuccess
          ? `Reply sent to ${student}.`
          : reject.isSuccess
            ? 'Draft rejected.'
            : ''}
      </p>
    </>
  )
}

function DraftForm({
  draft,
  student,
  senderVerified,
  approve,
  reject,
}: {
  draft: PendingDraft
  student: string
  senderVerified: boolean
  approve: ReturnType<typeof useApproveDraft>
  reject: ReturnType<typeof useRejectDraft>
}) {
  const form = useForm<Review>({
    resolver: zodResolver(reviewSchema),
    defaultValues: { body: draft.body },
  })
  const errors = form.formState.errors
  const busy = approve.isPending || reject.isPending
  const failure = approve.error ?? reject.error

  return (
    <section
      aria-labelledby="draft-heading"
      // Dashed, unlike the thread's solid messages: a draft must never read as sent mail.
      className="mt-8 rounded-md border border-dashed border-input bg-card p-5"
    >
      <h2 className="flex items-center gap-2 font-semibold" id="draft-heading">
        <Badge className="rounded-sm">AI</Badge>
        Draft reply awaiting review
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Nothing has been sent. Edit it if needed, then approve to email it to {student}, or reject
        it and reply yourself.
      </p>

      {/* The address may not be the student's: approving would email whoever
          it belongs to (#239). */}
      {!senderVerified && (
        <p className="mt-3 text-sm font-medium text-destructive">
          This sender's address was not verified, so it may be forged. Check the thread before
          approving.
        </p>
      )}

      {failure && (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {failure.message}
        </p>
      )}

      <form
        className="mt-4"
        noValidate
        onSubmit={form.handleSubmit((values) => {
          approve.mutate({ draftId: draft.id, updatedAt: draft.updatedAt, body: values.body })
        })}
      >
        <Field data-invalid={Boolean(errors.body)}>
          <FieldLabel htmlFor="draft-body">Draft reply to {student}</FieldLabel>
          <Textarea
            aria-describedby="draft-hint"
            aria-invalid={Boolean(errors.body)}
            disabled={busy}
            id="draft-body"
            rows={8}
            {...form.register('body')}
          />
          <FieldDescription id="draft-hint">
            Up to {REPLY_MAX_LENGTH.toLocaleString()} characters. Approving emails it and records
            you as its sender.
          </FieldDescription>
          <FieldError errors={[errors.body]} />
        </Field>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button disabled={busy} type="submit">
            <PendingLabel busy="Sending…" pending={approve.isPending}>
              Approve and send
            </PendingLabel>
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              reject.mutate(draft.id)
            }}
            type="button"
            variant="outline"
          >
            <PendingLabel busy="Rejecting…" pending={reject.isPending}>
              Reject
            </PendingLabel>
          </Button>
        </div>
      </form>
    </section>
  )
}
