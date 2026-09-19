import type { FieldError as FormError } from 'react-hook-form'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

type FormFieldProps = React.ComponentProps<'input'> & {
  id: string
  label: string
  error?: FormError
  /** A hint under the input, read out with it through aria-describedby. */
  description?: React.ReactNode
}

/**
 * One labelled input with its hint and its validation message. The rest of the
 * props go to the input, so `{...form.register('email')}` spreads straight in.
 */
export function FormField({ id, label, error, description, ...input }: FormFieldProps) {
  const hintId = description ? `${id}-hint` : undefined

  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input aria-describedby={hintId} aria-invalid={Boolean(error)} id={id} {...input} />
      {description && <FieldDescription id={hintId}>{description}</FieldDescription>}
      <FieldError errors={[error]} />
    </Field>
  )
}

/** A failure that belongs to the whole form rather than to one of its fields. */
export function FormAlert({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 text-sm text-destructive" role="alert">
      {children}
    </p>
  )
}
