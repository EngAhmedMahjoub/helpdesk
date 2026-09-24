import { Resend } from 'resend'
import { env } from '../env.ts'

/** The one Resend client: sending, reading received email and verifying webhooks. */
export const resend = new Resend(env.RESEND_API_KEY)
