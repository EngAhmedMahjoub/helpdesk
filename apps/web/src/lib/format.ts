/**
 * The app's date formats, built once at import rather than per row, and with
 * no locale given: dates read in whoever is looking at them's own.
 *
 * The `<time>` element around them belongs to each screen — one wants a title,
 * another a description list — but what a date looks like is one decision.
 */

/** A date alone, for a column that has no room for the time. */
export const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

/** A date and time, for anything a reader might need to place in the day. */
export const dateAndTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

/**
 * Short enough for a narrow cell; pair it with {@link fullDateTime} in a title.
 * The year stays: without it a ticket from last September reads as this one's.
 */
export const compactDateTime = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/** The whole stamp, spelled out, for the title behind a shortened one. */
export const fullDateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'full',
  timeStyle: 'short',
})
