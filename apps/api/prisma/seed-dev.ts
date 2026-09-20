import { prisma } from '../src/db.ts'
import { env } from '../src/env.ts'
import { statusChange } from '../src/tickets/status.ts'
import type {
  EscalationReason,
  MessageAuthor,
  TicketCategory,
  TicketStatus,
} from '../src/generated/prisma/client.ts'

// Sample tickets for working on the ticket screens before email and AI exist.
// Development only: the admin seed in seed.ts also runs against production, so
// this is a separate script rather than more of that one.
if (env.NODE_ENV !== 'development') {
  console.error(`Refusing to seed sample tickets with NODE_ENV=${env.NODE_ENV}.`)
  process.exit(1)
}

// NODE_ENV alone is not enough: it says how this process was started, not which
// database it is pointed at. A .env aimed at the hosted database to debug
// something, with NODE_ENV still development, would delete and rewrite sample
// tickets there. The host has to be this machine as well.
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', 'host.docker.internal']
const host = URL.parse(env.DATABASE_URL)?.hostname.replace(/^\[|\]$/g, '')

if (!host || !LOCAL_HOSTS.includes(host)) {
  console.error(
    `Refusing to seed sample tickets into a non-local database (host: ${host ?? 'unreadable'}).`,
  )
  process.exit(1)
}

// Every sample student is on this domain, which is how a re-run finds the
// tickets it made before. .example is reserved (RFC 2606), so no real student
// can share it and no mail sent to one can be delivered.
const SAMPLE_DOMAIN = 'student.example'

// Agent replies need an author. The seeded admin always exists once seed.ts
// has run, and admins answer tickets too.
const admin = await prisma.user.findFirst({ where: { isProtected: true } })
if (!admin) {
  console.error('No seeded admin found. Run `bun run db:seed` first.')
  process.exit(1)
}

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000)

type SampleMessage = { author: MessageAuthor; hoursAgo: number; body: string }

type SampleTicket = {
  subject: string
  student: string
  studentName: string | null
  status: TicketStatus
  category: TicketCategory | null
  summary: string | null
  escalationReason: EscalationReason | null
  messages: SampleMessage[]
}

const samples: SampleTicket[] = [
  {
    subject: "Can't log in to the course platform",
    student: 'maya.chen',
    studentName: 'Maya Chen',
    status: 'open',
    category: null,
    summary: null,
    escalationReason: null,
    messages: [
      {
        author: 'student',
        hoursAgo: 1,
        body: 'Hi, I reset my password twice but the login page keeps saying my details are wrong. My first lesson starts tomorrow.',
      },
    ],
  },
  {
    subject: 'Video lectures will not play',
    student: 'tom.okafor',
    studentName: 'Tom Okafor',
    status: 'resolved',
    category: 'technical',
    summary: 'Lecture videos stuck loading in Safari; fixed by allowing autoplay for the site.',
    escalationReason: null,
    messages: [
      {
        author: 'student',
        hoursAgo: 50,
        body: 'None of the week 2 videos load. The spinner just keeps going. I am on a Mac using Safari.',
      },
      {
        author: 'ai',
        hoursAgo: 49,
        body: 'Safari blocks the player until autoplay is allowed. Open Safari > Settings for This Website and set Auto-Play to "Allow All Auto-Play", then reload the lesson.',
      },
    ],
  },
  {
    subject: 'Refund for the Data Science bootcamp',
    student: 'lena.fischer',
    studentName: 'Lena Fischer',
    status: 'open',
    category: 'refund',
    summary: 'Asks for a full refund after withdrawing in week 1 for health reasons.',
    escalationReason: 'refund_approval',
    messages: [
      {
        author: 'student',
        hoursAgo: 20,
        body: 'I have had to withdraw from the bootcamp for health reasons after the first week. Could I get a refund please?',
      },
    ],
  },
  {
    subject: 'Name spelled wrong on my certificate',
    student: 'r.alvarez',
    studentName: null,
    status: 'open',
    category: 'general',
    summary: null,
    escalationReason: 'ai_failed',
    messages: [
      {
        author: 'student',
        hoursAgo: 6,
        body: 'My certificate says "Rafael Alvarz". It should be Rafael Álvarez, with the accent. Can it be reissued?',
      },
    ],
  },
  {
    subject: 'Where do I find assignment deadlines?',
    student: 'priya.nair',
    studentName: 'Priya Nair',
    status: 'resolved',
    category: 'general',
    summary: 'Deadlines are on the course calendar; follow-up asked about time zones.',
    escalationReason: null,
    messages: [
      {
        author: 'student',
        hoursAgo: 30,
        body: 'Where can I see when the assignments are due?',
      },
      {
        author: 'ai',
        hoursAgo: 29,
        body: 'Every deadline is on the Calendar tab of your course page, and each assignment shows its own due date at the top.',
      },
      {
        author: 'student',
        hoursAgo: 3,
        body: 'Thanks! Are those times in my time zone or UTC?',
      },
      {
        author: 'ai',
        hoursAgo: 2,
        body: 'They are shown in the time zone set on your profile. You can change it under Account > Preferences.',
      },
    ],
  },
  {
    subject: 'Quiz submitted but shows zero',
    student: 'sam.wright',
    studentName: 'Sam Wright',
    status: 'open',
    category: 'technical',
    summary: 'Quiz 3 answers saved but scored 0; agent asked for the submission time.',
    escalationReason: null,
    messages: [
      {
        author: 'student',
        hoursAgo: 26,
        body: 'I finished quiz 3 yesterday and it says I scored 0 out of 10. I definitely answered everything.',
      },
      {
        author: 'agent',
        hoursAgo: 24,
        body: 'Sorry about that, Sam. Roughly what time did you submit? I will check the grading log for your attempt.',
      },
      {
        author: 'student',
        hoursAgo: 22,
        body: 'Around 9pm, just before the deadline.',
      },
    ],
  },
  {
    subject: 'Can I move my start date?',
    student: 'jonas.berg',
    studentName: 'Jonas Berg',
    status: 'closed',
    category: 'general',
    summary: 'Moved from the March to the April cohort.',
    escalationReason: null,
    messages: [
      {
        author: 'student',
        hoursAgo: 24 * 20,
        body: 'Something has come up at work. Can I join the April cohort instead of March?',
      },
      {
        author: 'ai',
        hoursAgo: 24 * 20 - 1,
        body: 'You can move cohorts once, free of charge, up to a week before your start date. I have passed this to the team to confirm.',
      },
      {
        author: 'agent',
        hoursAgo: 24 * 19,
        body: 'Done — you are now in the April cohort, starting on the 7th. Your March place has been released.',
      },
    ],
  },
  {
    subject: 'Charged twice for the same course',
    student: 'aisha.bello',
    studentName: 'Aisha Bello',
    status: 'closed',
    category: 'refund',
    summary: 'Duplicate payment refunded after agent approval.',
    escalationReason: null,
    messages: [
      {
        author: 'student',
        hoursAgo: 24 * 30,
        body: 'My card was charged twice for Intro to Python on the same day. Please refund one of them.',
      },
      {
        author: 'agent',
        hoursAgo: 24 * 29,
        body: 'You are right, the second payment was a duplicate. I have refunded it; it should reach your card within 5 working days.',
      },
    ],
  },
]

// One transaction, so a failure part-way leaves the previous sample data in
// place rather than half of the new set.
const created = await prisma.$transaction(async (tx) => {
  // Messages go with their tickets (ON DELETE CASCADE).
  await tx.ticket.deleteMany({ where: { studentEmail: { endsWith: `@${SAMPLE_DOMAIN}` } } })

  let count = 0
  for (const sample of samples) {
    const studentEmail = `${sample.student}@${SAMPLE_DOMAIN}`
    const times = sample.messages.map((message) => hoursAgo(message.hoursAgo))
    const createdAt = times[0] ?? new Date()
    const updatedAt = times.at(-1) ?? createdAt

    await tx.ticket.create({
      data: {
        subject: sample.subject,
        studentEmail,
        studentName: sample.studentName,
        // Resolved as of the latest message, so the timer runs from there.
        ...statusChange(sample.status, updatedAt),
        category: sample.category,
        summary: sample.summary,
        needsAgent: sample.escalationReason !== null,
        escalationReason: sample.escalationReason,
        createdAt,
        updatedAt,
        messages: {
          create: sample.messages.map((message, index) => ({
            direction: message.author === 'student' ? 'inbound' : 'outbound',
            author: message.author,
            agentId: message.author === 'agent' ? admin.id : null,
            body: message.body,
            // Student and AI messages travelled by email, so they carry a
            // Message-ID. Agent replies are not emailed until Phase 4.
            emailMessageId:
              message.author === 'agent'
                ? null
                : `<seed-${sample.student}-${index}@${message.author === 'student' ? SAMPLE_DOMAIN : 'helpdesk.example'}>`,
            createdAt: times[index],
          })),
        },
      },
    })
    count += 1
  }
  return count
})

console.log(`Seeded ${created} sample tickets for ${SAMPLE_DOMAIN} students.`)

await prisma.$disconnect()
