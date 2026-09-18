import { z } from 'zod'

// One definition per field, used by the API to enforce the limits and by the
// web forms to report them before the request is sent, so the two cannot drift
// apart. The API answers every failure with one 400 and never shows these
// messages; they are written for the forms.

// 254 is the longest address SMTP can deliver to. Without a cap, a few KB
// overflowed the unique index's 2704-byte row limit: Postgres refused the insert
// and the admin got a 500, after argon2 had already been paid for.
export const EMAIL_MAX_LENGTH = 254
export const NAME_MAX_LENGTH = 100
// The seed holds ADMIN_PASSWORD to the same minimum, so the admin an agent is
// created by cannot hold a weaker password than the agent. The cap keeps a
// 100KB body — what express.json() allows — out of argon2.
export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 200

// Named, because the edit dialog builds its own blank-or-valid password rule
// and must report the same words as this one.
export const PASSWORD_TOO_SHORT = `Use at least ${PASSWORD_MIN_LENGTH} characters`
export const PASSWORD_TOO_LONG = `Keep the password under ${PASSWORD_MAX_LENGTH} characters`

export const emailField = z
  .email('Enter a valid email address')
  .max(EMAIL_MAX_LENGTH, `Use at most ${EMAIL_MAX_LENGTH} characters`)

export const nameField = z
  .string()
  .trim()
  .min(1, 'Enter a name')
  .max(NAME_MAX_LENGTH, `Keep the name under ${NAME_MAX_LENGTH} characters`)

export const passwordField = z
  .string()
  .min(PASSWORD_MIN_LENGTH, PASSWORD_TOO_SHORT)
  .max(PASSWORD_MAX_LENGTH, PASSWORD_TOO_LONG)

/** The body of `POST /api/users`. The role is not sent: the API only creates agents. */
export const createUserSchema = z.object({
  email: emailField,
  name: nameField,
  password: passwordField,
})

export type CreateUserRequest = z.infer<typeof createUserSchema>

/**
 * The body of `PATCH /api/users/:id`: any of these, at least one. Deactivating
 * ends every session the user holds, and so does setting their password, except
 * the one an admin changes their own from.
 *
 * Anything else in the body — role, isProtected — is stripped by zod, so an
 * empty change is a 400 rather than a silent no-op that looks like it did
 * something.
 */
export const updateUserSchema = z
  .object({
    name: nameField.optional(),
    email: emailField.optional(),
    password: passwordField.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined))

export type UpdateUserRequest = z.infer<typeof updateUserSchema>

/**
 * The body of `POST /api/auth/login`. Only what the client can know: the API
 * answers one 401 with the same message for an unknown email, a wrong password
 * and a deactivated account, and nothing here should imply otherwise.
 */
export const loginSchema = z.object({
  email: z.email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
})

export type LoginRequest = z.infer<typeof loginSchema>
