import { z } from 'zod'

// NODE_ENV and WEB_ORIGIN carry no defaults on purpose. Both decide how tightly
// the API is locked down — NODE_ENV gates the Secure flag on the session cookie,
// WEB_ORIGIN is the single origin allowed to call it with credentials — so a
// default would let a deploy that forgot one start anyway, serving a cookie
// usable over plain HTTP or trusting a localhost dev server. Refusing to boot is
// the loud failure; a quiet insecure default is not.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z
    .url({ protocol: /^postgres(ql)?$/ })
    .describe('PostgreSQL connection string, e.g. postgresql://user:password@host:5432/db'),
  WEB_ORIGIN: z
    .url({ protocol: /^https?$/ })
    .describe('Origin allowed to call the API with credentials, e.g. https://app.example.com'),
})

type Env = z.infer<typeof envSchema>

const result = envSchema.safeParse(process.env)

if (!result.success) {
  console.error('Invalid environment configuration:')
  console.error(z.prettifyError(result.error))
  process.exit(1)
}

export const env: Env = result.data
