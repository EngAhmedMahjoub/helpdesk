import { z } from 'zod'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@helpdesk/shared'
import { prisma } from '../src/db.ts'
import { hashPassword } from '../src/auth/password.ts'

// Seed-only variables: the running API never reads them, so they are validated
// here rather than in src/env.ts, which would otherwise refuse to start the API
// without admin credentials it never uses.
const seedEnvSchema = z.object({
  ADMIN_EMAIL: z.email(),
  // No weaker than the agents this admin creates; see PASSWORD_MIN_LENGTH. No
  // longer than login accepts either, or the seeded admin could never sign in.
  ADMIN_PASSWORD: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
})

const result = seedEnvSchema.safeParse(process.env)

if (!result.success) {
  console.error('Invalid seed environment configuration:')
  console.error(z.prettifyError(result.error))
  process.exit(1)
}

const email = result.data.ADMIN_EMAIL.toLowerCase()

// Upsert keyed on the unique email, so a second run matches the existing row
// instead of inserting a duplicate. update never touches the password:
// re-seeding must not reset the password of an admin who has since changed it.
//
// It does mark the admin protected and active. Protected, so no one can
// deactivate them through the app. Active, so re-running the seed recovers the
// one account that can manage users if it was switched off some other way —
// before this column existed, or by hand in the database.
const admin = await prisma.user.upsert({
  where: { email },
  update: { isProtected: true, isActive: true },
  create: {
    email,
    name: 'Admin',
    passwordHash: await hashPassword(result.data.ADMIN_PASSWORD),
    role: 'admin',
    isProtected: true,
  },
})

console.log(`Admin ready: ${admin.email} (${admin.id})`)

await prisma.$disconnect()
