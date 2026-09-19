import { beforeEach, describe, expect, test } from 'bun:test'
import { prisma, resetDatabase } from './db.ts'

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
