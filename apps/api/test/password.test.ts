import { describe, expect, test } from 'bun:test'
import { hashPassword, verifyPassword } from '../src/auth/password.ts'

const password = 'correct horse battery staple'

describe('hashPassword', () => {
  test('returns an argon2id hash, not the password', async () => {
    const hash = await hashPassword(password)

    expect(hash).toStartWith('$argon2id$')
    expect(hash).not.toContain(password)
  })

  test('salts every hash, so the same password never hashes to the same string', async () => {
    const [first, second] = await Promise.all([hashPassword(password), hashPassword(password)])

    expect(first).not.toBe(second)
    // Both still verify: the salt is carried inside the hash.
    expect(await verifyPassword(password, first)).toBe(true)
    expect(await verifyPassword(password, second)).toBe(true)
  })
})

describe('verifyPassword', () => {
  test('accepts the password the hash was made from', async () => {
    expect(await verifyPassword(password, await hashPassword(password))).toBe(true)
  })

  test('rejects a wrong password', async () => {
    expect(await verifyPassword('wrong password', await hashPassword(password))).toBe(false)
  })

  test('rejects near misses in case, whitespace, and length', async () => {
    const hash = await hashPassword(password)

    expect(await verifyPassword('Correct horse battery staple', hash)).toBe(false)
    expect(await verifyPassword(`${password} `, hash)).toBe(false)
    expect(await verifyPassword(password.slice(0, -1), hash)).toBe(false)
  })

  test('round-trips non-ASCII passwords', async () => {
    const unicode = 'pässwörd-كلمة-🔐'
    const hash = await hashPassword(unicode)

    expect(await verifyPassword(unicode, hash)).toBe(true)
    expect(await verifyPassword('passwörd-كلمة-🔐', hash)).toBe(false)
  })

  // Bun.password.verify throws PASSWORD_INVALID_ENCODING on an unparseable
  // hash; the helper catches it so a corrupt row fails the login instead of
  // turning it into a 500.
  test('returns false for a malformed hash rather than throwing', async () => {
    expect(await verifyPassword(password, '$argon2id$not-a-real-hash')).toBe(false)
    expect(await verifyPassword(password, '')).toBe(false)
  })
})
