import type { Request, Response } from 'express'
import type { z } from 'zod'

function parseOr400<S extends z.ZodType>(
  schema: S,
  input: unknown,
  res: Response,
  error: string,
): z.output<S> | undefined {
  const result = schema.safeParse(input)
  if (!result.success) {
    res.status(400).json({ error })
    return undefined
  }
  return result.data
}

/**
 * The request body parsed by `schema`, or undefined once a 400 has been sent.
 * The caller returns on undefined; every failure gets the same body.
 */
export function parseBody<S extends z.ZodType>(
  schema: S,
  req: Request,
  res: Response,
): z.output<S> | undefined {
  return parseOr400(schema, req.body, res, 'Invalid request body')
}

/** The query string parsed by `schema`, or undefined once a 400 has been sent. */
export function parseQuery<S extends z.ZodType>(
  schema: S,
  req: Request,
  res: Response,
): z.output<S> | undefined {
  return parseOr400(schema, req.query, res, 'Invalid query')
}

/**
 * `req.params.id` parsed by `schema`, or undefined once a 404 has been sent.
 *
 * A malformed id answers the same 404 as a well-formed one with no row: it
 * cannot name a record either way, and saying which is which would tell a
 * caller what the ids look like.
 */
export function parseId<S extends z.ZodType>(
  schema: S,
  req: Request,
  res: Response,
  error: string,
): z.output<S> | undefined {
  const result = schema.safeParse(req.params.id)
  if (!result.success) {
    res.status(404).json({ error })
    return undefined
  }
  return result.data
}
