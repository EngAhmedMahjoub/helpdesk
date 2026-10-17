/**
 * Links, email addresses and bare domains: what a reader can follow or write
 * to. One pattern for Polish's guard and for the hold on automatic replies
 * (#328), so the two cannot disagree on what counts as a link.
 *
 * Alternatives are tried in order at each position, so an email address or a
 * URL is taken whole before its domain could be taken alone. A bare domain
 * must end in letters, which keeps "e.g." and "3.5" out.
 */
export const LINK =
  /https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b(?:\/\S*)?/giu

/**
 * A matched token, lower-cased and without trailing punctuation, so a link
 * that ends a sentence is the same link with or without the full stop.
 */
export function normaliseToken(token: string): string {
  return token.replace(/[.,;:!?)\]'"]+$/, '').toLowerCase()
}

/** Every link, address and bare domain in `text`, normalised. */
export function linkTokens(text: string): string[] {
  return (text.match(LINK) ?? []).map(normaliseToken)
}

/** The host a link token points at: the domain of an address, or a URL's host. */
export function linkHost(token: string): string {
  const at = token.lastIndexOf('@')
  if (at !== -1 && !token.includes('/')) return token.slice(at + 1)
  return token
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#:]/)[0]!
}

/** Whether `host` is `domain` or one of its subdomains. */
function within(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

/**
 * The first link in `text` whose host is none of `hosts` (or their
 * subdomains) and which is not one of `addresses`, or undefined when every
 * link is known.
 *
 * Hosts rather than whole links: a page on the academy's own domain, or on a
 * site the knowledge base already names, is somewhere the academy chose to
 * send students. Addresses are matched whole, since a student's own address
 * may be repeated back to them but their domain is not the academy's to vouch
 * for.
 */
export function unknownLink(
  text: string,
  known: { hosts: string[]; addresses: string[] },
): string | undefined {
  const hosts = known.hosts.map((host) => host.toLowerCase().replace(/^www\./, ''))
  const addresses = new Set(known.addresses.map((address) => address.toLowerCase()))
  return linkTokens(text).find(
    (token) => !addresses.has(token) && !hosts.some((host) => within(linkHost(token), host)),
  )
}
