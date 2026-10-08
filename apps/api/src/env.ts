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
  // How many proxies stand between the client and the API, for Express's
  // `trust proxy`, so req.ip is the client and the login limit keys on them.
  // Render is 3, measured on 2026-10-06 (#87): Cloudflare, Render's load
  // balancer, and a proxy beside the app on localhost. Too low and every client
  // shares a proxy's address and one login budget; too high and an
  // X-Forwarded-For entry the client wrote is believed, so anyone could reset
  // their own budget. 0 trusts none, which is right wherever nothing sits in
  // front: locally and in tests.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  DATABASE_URL: z
    .url({ protocol: /^postgres(ql)?$/ })
    .describe('PostgreSQL connection string, e.g. postgresql://user:password@host:5432/db'),
  WEB_ORIGIN: z
    .url({ protocol: /^https?$/ })
    .describe('Origin allowed to call the API with credentials, e.g. https://app.example.com'),
  // Required rather than optional: an API that boots without them answers
  // agents normally and only fails when a reply goes out, long after the
  // deploy that forgot them.
  RESEND_API_KEY: z.string().startsWith('re_').describe('Resend API key, e.g. re_123'),
  EMAIL_FROM: z
    .string()
    .regex(/^(?:[^<>]*<[^<>\s@]+@[^<>\s@]+>|[^<>\s@]+@[^<>\s@]+)$/)
    .describe('Sender, e.g. Helpdesk Support <support@helpdesk.example.com>'),
  // Required for the same reason: without it no inbound email could ever be
  // verified, and every one would be refused while the API looked healthy.
  RESEND_WEBHOOK_SECRET: z
    .string()
    .startsWith('whsec_')
    .describe("Signing secret from the webhook's page in Resend, e.g. whsec_abc123"),
  // Required like the Resend keys, and for the same reason: an API that boots
  // without it looks healthy until a ticket needs classifying, which is long
  // after the deploy that forgot it. The prefix is checked so a truncated or
  // pasted-over value fails here rather than as a 401 from Anthropic.
  ANTHROPIC_API_KEY: z
    .string()
    .startsWith('sk-ant-')
    .describe('Anthropic API key, e.g. sk-ant-api03-...'),
  // Required: without it the scheduled workflow's calls would all be refused
  // and no Resolved ticket would ever close, with nothing failing loudly. At
  // least 32 characters, so a placeholder or a short guessable word is refused.
  TASKS_SECRET: z
    .string()
    .min(32)
    .describe('Shared secret the scheduled workflow sends, e.g. from `openssl rand -hex 32`'),
  // Optional, unlike the keys above: without it the API works exactly as
  // before and only stops reporting errors, and development, the tests and the
  // e2e servers must not report at all.
  SENTRY_DSN: z
    .url({ protocol: /^https$/ })
    .optional()
    .describe("The API project's DSN from Sentry, e.g. https://abc@o1.ingest.sentry.io/2"),
  // The commit the image was built from, baked in by the deploy workflow, so
  // an event names the deploy it came from. Empty in an image built by hand
  // without it, which means none rather than a release called ''.
  SENTRY_RELEASE: z
    .string()
    .optional()
    .transform((release) => release || undefined),
})

type Env = z.infer<typeof envSchema>

const result = envSchema.safeParse(process.env)

if (!result.success) {
  console.error('Invalid environment configuration:')
  console.error(z.prettifyError(result.error))
  process.exit(1)
}

export const env: Env = result.data
