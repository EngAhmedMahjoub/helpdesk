import { prisma } from '../src/db.ts'

export { prisma }

/**
 * Empties every application table so each test starts from a known state.
 *
 * Table names are read from pg_tables rather than hardcoded, so models added
 * later (Ticket, Message, ReplyDraft) are covered without touching this file.
 * `_prisma_migrations` is left alone: dropping it would make Prisma believe the
 * schema had never been migrated.
 */
export async function resetDatabase(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `

  if (tables.length === 0) return

  // $executeRawUnsafe because table names cannot be bound as parameters. The
  // names come from the catalogue, never from test input.
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ')
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)
}
