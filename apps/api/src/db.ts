import { PrismaPg } from '@prisma/adapter-pg'
import { env } from './env.ts'
import { PrismaClient } from './generated/prisma/client.ts'

export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
})
