import { randomBytes } from 'node:crypto'

// Bun ships argon2id hashing in `Bun.password`, so neither argon2 nor bcrypt is
// needed. Defaults are argon2id v19, m=65536 KiB, t=2, p=1 — roughly 100ms per
// hash. The algorithm and its parameters are encoded in the returned string, so
// verify reads them back and needs no options of its own.

export function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await Bun.password.verify(password, hash)
  } catch (err) {
    // Bun throws on an unparseable hash instead of returning false. A stored
    // hash should never be malformed, so log it, but answer false: a corrupt
    // row must fail the login, not turn it into a 500.
    console.error('Password verification failed to parse the stored hash:', err)
    return false
  }
}

/**
 * Hash of a random value no password can match. Started at import, so the
 * ~100ms it costs is paid once at boot rather than inside the first request
 * that needs it.
 */
const dummyHash = hashPassword(randomBytes(32).toString('hex'))

/**
 * Spends the same argon2 time as a real verification, and always fails.
 *
 * A login for an address with no account has no hash to check, so returning
 * early would answer in about 2ms where a real account takes about 110ms. That
 * gap is a reliable oracle: one request per address tells an attacker which of
 * them exist, which is exactly what the identical 401 body is there to prevent.
 */
export async function verifyAgainstDummyHash(password: string): Promise<boolean> {
  return verifyPassword(password, await dummyHash)
}
