import type { Request, Response } from 'express'
import type { z } from 'zod'

/**
 * The request body parsed by `schema`, or undefined once a 400 has been sent.
 * The caller returns on undefined; every failure gets the same body.
 */
export function parseBody<S extends z.ZodType>(
  schema: S,
  req: Request,
  res: Response,
): z.output<S> | undefined {
  const result = schema.safeParse(req.body)
  if (!result.success) {
    res.status(400).json({ error: 'Invalid request body' })
    return undefined
  }
  return result.data
}
