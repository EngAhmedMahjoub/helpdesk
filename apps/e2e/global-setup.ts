import { PrismaPg } from '@prisma/adapter-pg'
import { ADMIN, DATABASE_URL } from './config.ts'
import { PrismaClient } from '../api/src/generated/prisma/client.ts'

/**
 * Checks the database was prepared, and says so plainly when it was not.
 *
 * The preparation itself cannot live here: Playwright starts `webServer` before
 * global setup, so the API would already have failed to connect. `bun run
 * test:e2e` runs `prepare-database.ts` first. Someone invoking `playwright test`
 * directly skips that, and without this check would meet a Prisma stack trace
 * rather than a sentence telling them what to do.
 */
export default async function globalSetup(): Promise<void> {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) })

  try {
    const admin = await prisma.user.findUnique({ where: { email: ADMIN.email } })

    if (!admin) {
      throw new Error(
        `The end-to-end database has no ${ADMIN.email}. Run "bun run test:e2e" from the ` +
          'repo root, which prepares the database first, or "bun prepare-database.ts" here.',
      )
    }
  } finally {
    await prisma.$disconnect()
  }
}
