import type { RequestHandler } from 'express'
import { env } from '../env.ts'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Refuses a state-changing request sent from a page that is not the web app
 * (#249, Phase 6 security review). The session cookie is SameSite=Lax, which
 * keeps it off requests from other sites but not from sibling subdomains: a
 * page on another subdomain of the production domain is same-site, so its
 * plain form POST would carry the cookie with no CORS preflight, and could
 * reject drafts or sign an agent out. Browsers name the page in `Origin` on
 * every POST, PATCH and DELETE, so one check here covers every route.
 *
 * A request with no `Origin` is let through: it did not come from a page.
 * The scheduled workflow, the tests and curl send none, and each still needs
 * the session or the shared secret its route asks for.
 */
export const refuseForeignOrigin: RequestHandler = (req, res, next) => {
  const origin = req.get('origin')
  if (SAFE_METHODS.has(req.method) || origin === undefined || origin === env.WEB_ORIGIN) {
    next()
    return
  }
  // The origin only, never the request: it says which page tried.
  console.warn(`Refused a ${req.method} from origin ${origin}`)
  res.status(403).json({ error: 'Forbidden' })
}
