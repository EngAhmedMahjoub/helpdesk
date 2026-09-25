// What counts as a Message-ID the API will store, look up or send (#210).
//
// A Message-ID comes from whoever sent the email, and a stored one is later
// copied into the In-Reply-To and References headers of our replies. So the
// rule is strict: one bracketed token with no whitespace, quotes or control
// characters, which rules out CR/LF header injection, and short enough that the
// headers stay within RFC 5322's line limit and the unique index's row size.

// Real Message-IDs are well under 100 characters. 250 non-ASCII characters are
// at most 750 bytes of UTF-8, well inside btree's 2704-byte index row; 998, the
// old cap, made a 3008-byte row the unique index refused on every retry.
export const MESSAGE_ID_MAX_LENGTH = 250

// \p{Cc} covers NUL and every other control character, CR and LF included.
const MESSAGE_ID_PATTERN = /^<[^<>\s"\p{Cc}]+>$/u

export function isStorableMessageId(id: string): boolean {
  return id.length <= MESSAGE_ID_MAX_LENGTH && MESSAGE_ID_PATTERN.test(id)
}
