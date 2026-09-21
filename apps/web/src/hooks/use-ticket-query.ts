import { useSearchParams } from 'react-router'
import { type ListTicketsQuery, listTicketsQuerySchema } from '@helpdesk/shared'

/**
 * The filters, sort and page live in the URL rather than in component state, so
 * a filtered list can be linked to, survives a reload, and the back button
 * steps through the choices an agent made.
 */
export function useTicketQuery() {
  const [searchParams, setSearchParams] = useSearchParams()

  // A URL nobody typed by hand always parses. A hand-edited one that does not
  // falls back to the default list rather than showing an error a visitor
  // cannot act on; the controls below then rewrite it.
  const parsed = listTicketsQuerySchema.safeParse(Object.fromEntries(searchParams))
  // The schema's output, not its input: every field carries its default from
  // here on, so nothing downstream has to re-state them.
  const query = parsed.success ? parsed.data : listTicketsQuerySchema.parse({})

  function update(changes: Partial<ListTicketsQuery>, options: { keepPage?: boolean } = {}) {
    const next = { ...query, ...changes }
    // Any change but paging returns to page 1: page 3 of the old filter is
    // rarely a page of the new one, and an empty page looks like no tickets.
    if (!options.keepPage) next.page = 1

    setSearchParams(
      Object.fromEntries(
        Object.entries(next)
          .filter(([, value]) => value !== undefined && value !== '')
          .map(([key, value]) => [key, String(value)]),
      ),
    )
  }

  return { query, update }
}
