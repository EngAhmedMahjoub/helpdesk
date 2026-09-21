import { beforeEach, describe, expect, test } from 'bun:test'
import { prisma, resetDatabase } from './db.ts'
import { createMessage } from './fixtures.ts'

beforeEach(resetDatabase)

describe('test database', () => {
  test('is a separate database from development', () => {
    // .env.test overrides .env, so a test run can never truncate the dev data.
    expect(process.env.DATABASE_URL).toContain('/helpdesk_test')
  })

  test('has the migrated schema and accepts real writes', async () => {
    const user = await prisma.user.create({
      data: { email: 'someone@example.com', name: 'Someone', passwordHash: 'x' },
    })

    expect(user.id).toBeString()
    expect(user.role).toBe('agent')
    expect(user.isActive).toBe(true)
    expect(await prisma.user.count()).toBe(1)
  })

  test('enforces constraints rather than accepting anything', async () => {
    await prisma.user.create({
      data: { email: 'dupe@example.com', name: 'First', passwordHash: 'x' },
    })

    // Wrapped in an async function: Prisma returns a thenable, not a Promise,
    // and bun:test's .rejects requires a real one.
    const insertDuplicate = async () =>
      prisma.user.create({
        data: { email: 'dupe@example.com', name: 'Second', passwordHash: 'x' },
      })

    await expect(insertDuplicate()).rejects.toThrow()
  })

  test('is empty again for the next test', async () => {
    // The two tests above each wrote a user; resetDatabase cleared them.
    expect(await prisma.user.count()).toBe(0)
    expect(await prisma.session.count()).toBe(0)
  })
})

describe('Ticket', () => {
  test('starts Open, unclassified and not escalated', async () => {
    const ticket = await prisma.ticket.create({
      data: { subject: 'Cannot log in', studentEmail: 'student@example.com' },
    })

    expect(ticket).toMatchObject({
      status: 'open',
      studentName: null,
      category: null,
      summary: null,
      needsAgent: false,
      escalationReason: null,
      autoCloseAt: null,
    })
  })

  test('refuses a status, category or escalation reason outside its enum', async () => {
    // Raw SQL, because Prisma's own types would not let the bad values compile:
    // this checks the database refuses them, not the client.
    for (const [column, value] of [
      ['status', 'pending'],
      ['category', 'billing'],
      ['escalationReason', 'angry_student'],
    ]) {
      const insert = async () =>
        prisma.$executeRawUnsafe(
          `INSERT INTO "Ticket" (subject, "studentEmail", "updatedAt", "${column}")
           VALUES ('S', 's@example.com', now(), $1)`,
          value,
        )
      await expect(insert()).rejects.toThrow()
    }
  })
})

describe('Message', () => {
  const newTicket = () =>
    prisma.ticket.create({
      data: { subject: 'Cannot log in', studentEmail: 'student@example.com' },
    })

  test('belongs to a ticket and is deleted with it', async () => {
    const ticket = await newTicket()
    await createMessage({ ticketId: ticket.id })

    await prisma.ticket.delete({ where: { id: ticket.id } })

    expect(await prisma.message.count()).toBe(0)
  })

  test('refuses a second message with the same email Message-ID, but not two without one', async () => {
    const ticket = await newTicket()
    const message = (emailMessageId: string | null) =>
      createMessage({ ticketId: ticket.id, emailMessageId })

    await message('<abc@mail.example.com>')
    await message(null)
    await message(null)

    await expect((async () => message('<abc@mail.example.com>'))()).rejects.toThrow()
    expect(await prisma.message.count()).toBe(3)
  })

  test('keeps the agent who wrote a reply: their user row cannot be deleted', async () => {
    const ticket = await newTicket()
    const agent = await prisma.user.create({
      data: { email: 'agent@example.com', name: 'Agent', passwordHash: 'x' },
    })
    await createMessage({
      ticketId: ticket.id,
      direction: 'outbound',
      author: 'agent',
      agentId: agent.id,
      body: 'Try resetting your password.',
    })

    await expect((async () => prisma.user.delete({ where: { id: agent.id } }))()).rejects.toThrow()
  })

  test('refuses a direction or author outside its enum', async () => {
    const ticket = await newTicket()

    // Raw SQL for the same reason as the Ticket enums: the client would not compile these.
    const insert = async (direction: string, author: string) =>
      prisma.$executeRaw`
        INSERT INTO "Message" ("ticketId", body, direction, author)
        VALUES (${ticket.id}, 'Help', ${direction}::"MessageDirection", ${author}::"MessageAuthor")`

    await expect(insert('sideways', 'student')).rejects.toThrow()
    await expect(insert('inbound', 'system')).rejects.toThrow()
    // The same insert with valid values goes through, so the two above failed on
    // the enum and not on something else in the statement.
    await insert('inbound', 'student')
    expect(await prisma.message.count()).toBe(1)
  })
})
