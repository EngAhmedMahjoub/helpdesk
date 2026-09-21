import type { TicketMessage } from '@helpdesk/shared'
import { Badge } from '@/components/ui/badge'
import { dateAndTime } from '@/lib/format'

/**
 * How each author appears. The label is the ticket's own word for who wrote a
 * message, so the three are told apart by what they say rather than by colour
 * alone; the tint and the side only second it.
 */
const styles = {
  student: {
    badge: 'secondary',
    // Inbound sits left and full width against the outbound replies' inset.
    row: 'mr-auto',
    card: 'bg-muted/40',
  },
  ai: { badge: 'outline', row: 'ml-auto', card: 'bg-background border-dashed' },
  agent: { badge: 'default', row: 'ml-auto', card: 'bg-background' },
} as const

function who(message: TicketMessage, studentName: string): string {
  if (message.author === 'student') return studentName
  if (message.author === 'ai') return 'AI assistant'
  // An agent whose account has since been deleted leaves the reply behind.
  return message.agent?.name ?? 'An agent'
}

const roleLabels = { student: 'Student', ai: 'AI', agent: 'Agent' } as const

export default function MessageThread({
  messages,
  studentName,
}: {
  messages: TicketMessage[]
  studentName: string
}) {
  if (messages.length === 0) {
    return (
      <p className="text-muted-foreground" role="status">
        This ticket has no messages yet.
      </p>
    )
  }

  return (
    // A list, so a screen reader announces how many messages there are and
    // which one it is on; the thread reads oldest first, as the API sends it.
    <ol className="flex flex-col gap-4">
      {messages.map((message) => {
        const style = styles[message.author]
        const author = who(message, studentName)

        return (
          <li className={`w-11/12 ${style.row}`} key={message.id}>
            <article
              aria-label={`${roleLabels[message.author]} message from ${author}`}
              className={`rounded-lg border p-4 ${style.card}`}
            >
              <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-medium text-foreground">{author}</span>
                <Badge variant={style.badge}>{roleLabels[message.author]}</Badge>
                <time
                  className="ml-auto text-sm text-muted-foreground"
                  dateTime={message.createdAt}
                >
                  {dateAndTime.format(new Date(message.createdAt))}
                </time>
              </header>
              {/* whitespace-pre-wrap: an email's own line breaks are the only
                  formatting a plain-text body carries. */}
              <p className="mt-2 whitespace-pre-wrap text-foreground">{message.body}</p>
            </article>
          </li>
        )
      })}
    </ol>
  )
}
