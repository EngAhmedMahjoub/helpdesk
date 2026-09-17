import { $ } from 'bun'
import { ADMIN, DATABASE_URL } from './config.ts'

const apiDir = new URL('../api/', import.meta.url).pathname

/**
 * Brings `helpdesk_e2e` to a known state: schema up to date, every table empty,
 * one admin to sign in as.
 *
 * Deliberately not Playwright's `globalSetup`. Playwright starts `webServer`
 * before global setup runs, so by then the API has already tried to connect and
 * died on a database that does not exist yet. This runs ahead of Playwright, as
 * the first half of the `test:e2e` script.
 *
 * Runs once per run, not per test. End-to-end tests share this database, so
 * anything a test creates it should clean up or namespace itself — this is a
 * floor, not isolation.
 */
export async function prepareDatabase(): Promise<void> {
  const target = DATABASE_URL.split('/').pop()?.split('?')[0] ?? 'unknown'

  // A misconfigured URL here would migrate and truncate the development
  // database. Refuse rather than find out afterwards.
  if (!target.endsWith('_e2e')) {
    throw new Error(
      `Refusing to run: the end-to-end database must be named *_e2e, got "${target}". ` +
        'Check E2E_DATABASE_URL.',
    )
  }

  console.log(`[e2e] preparing ${target}`)

  // migrate deploy creates the database if it does not exist, so there is no
  // separate create step. Applies migrations only; it never generates new ones.
  await $`bun --bun run prisma migrate deploy`
    .cwd(apiDir)
    .env({ ...process.env, DATABASE_URL })
    .quiet()

  const { PrismaClient } = await import('../api/src/generated/prisma/client.ts')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const { hashPassword } = await import('../api/src/auth/password.ts')

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) })

  try {
    // Table names come from the catalogue rather than a hardcoded list, so
    // models added later are covered without touching this file.
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `

    if (tables.length > 0) {
      const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ')
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)
    }

    await prisma.user.create({
      data: {
        email: ADMIN.email,
        name: ADMIN.name,
        passwordHash: await hashPassword(ADMIN.password),
        role: 'admin',
      },
    })

    console.log(`[e2e] ${target} ready with ${ADMIN.email}`)
  } finally {
    await prisma.$disconnect()
  }
}

await prepareDatabase()
