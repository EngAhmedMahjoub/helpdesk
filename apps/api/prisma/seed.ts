import { z } from 'zod'
import { prisma } from '../src/db.ts'
import { hashPassword } from '../src/auth/password.ts'

// Seed-only variables: the running API never reads them, so they are validated
// here rather than in src/env.ts, which would otherwise refuse to start the API
// without admin credentials it never uses.
const seedEnvSchema = z.object({
  ADMIN_EMAIL: z.email(),
  ADMIN_PASSWORD: z.string().min(12),
})

const result = seedEnvSchema.safeParse(process.env)

if (!result.success) {
  console.error('Invalid seed environment configuration:')
  console.error(z.prettifyError(result.error))
  process.exit(1)
}

const email = result.data.ADMIN_EMAIL.toLowerCase()

// Upsert keyed on the unique email, so a second run matches the existing row
// instead of inserting a duplicate. update is empty on purpose: re-seeding must
// not reset the password of an admin who has since changed it.
const admin = await prisma.user.upsert({
  where: { email },
  update: {},
  create: {
    email,
    name: 'Admin',
    passwordHash: await hashPassword(result.data.ADMIN_PASSWORD),
    role: 'admin',
  },
})

console.log(`Admin ready: ${admin.email} (${admin.id})`)

await prisma.$disconnect()
