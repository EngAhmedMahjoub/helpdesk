import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z
    .url({ protocol: /^postgres(ql)?$/ })
    .describe('PostgreSQL connection string, e.g. postgresql://user:password@host:5432/db'),
})

export type Env = z.infer<typeof envSchema>

const result = envSchema.safeParse(process.env)

if (!result.success) {
  console.error('Invalid environment configuration:')
  console.error(z.prettifyError(result.error))
  process.exit(1)
}

export const env: Env = result.data
