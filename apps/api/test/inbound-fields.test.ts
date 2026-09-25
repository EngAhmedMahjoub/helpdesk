import { describe, expect, test } from 'bun:test'
import { EMAIL_MAX_LENGTH, NAME_MAX_LENGTH } from '@helpdesk/shared'
import type { InboundEmail } from '../src/email/inbound.ts'
import {
  INBOUND_TEXT_MAX_LENGTH,
  NO_SUBJECT,
  NO_TEXT,
  SUBJECT_MAX_LENGTH,
  TEXT_SHORTENED,
  inboundTicketFields,
} from '../src/email/inbound-fields.ts'
import { MESSAGE_ID_MAX_LENGTH } from '../src/email/message-id.ts'

const email: InboundEmail = {
  fromAddress: 'maya.chen@uni.edu',
  fromName: 'Maya Chen',
  subject: 'Cannot log in',
  text: 'I reset my password but the portal still says it is wrong.\n',
  messageId: '<first@mail.uni.edu>',
  inReplyTo: null,
  references: [],
}

const fields = (overrides: Partial<InboundEmail>) => inboundTicketFields({ ...email, ...overrides })
const length = (value: string) => Array.from(value).length

describe('inboundTicketFields', () => {
  test('passes a well-formed email through, trimmed', () => {
    expect(fields({ subject: '  Cannot log in ', fromName: ' Maya Chen ' })).toEqual({
      studentEmail: 'maya.chen@uni.edu',
      studentName: 'Maya Chen',
      subject: 'Cannot log in',
      body: 'I reset my password but the portal still says it is wrong.',
      emailMessageId: '<first@mail.uni.edu>',
    })
  })

  describe('studentEmail', () => {
    test.each(['not-an-address', 'maya@', '@uni.edu', 'maya chen@uni.edu', ''])(
      'refuses the malformed sender %p',
      (fromAddress) => {
        expect(fields({ fromAddress })).toBeNull()
      },
    )

    test('refuses a well-formed sender longer than any deliverable address', () => {
      // Built from 60-character labels, so only its length can be the reason.
      const address = (labels: number) =>
        `${'a'.repeat(64)}@${Array(labels).fill('b'.repeat(60)).join('.')}.edu`
      expect(address(2).length).toBeLessThanOrEqual(EMAIL_MAX_LENGTH)
      expect(address(4).length).toBeGreaterThan(EMAIL_MAX_LENGTH)

      expect(fields({ fromAddress: address(2) })).not.toBeNull()
      expect(fields({ fromAddress: address(4) })).toBeNull()
    })
  })

  describe('subject', () => {
    test(`is kept whole at ${String(SUBJECT_MAX_LENGTH)} characters`, () => {
      const subject = 's'.repeat(SUBJECT_MAX_LENGTH)

      expect(fields({ subject })?.subject).toBe(subject)
    })

    test('is cut to the cap, ending in "…", when longer', () => {
      const subject = fields({ subject: 's'.repeat(5_000) })?.subject ?? ''

      expect(length(subject)).toBe(SUBJECT_MAX_LENGTH)
      expect(subject).toEndWith('s…')
    })

    test('is "(no subject)" when empty or blank', () => {
      expect(fields({ subject: '' })?.subject).toBe(NO_SUBJECT)
      expect(fields({ subject: '   ' })?.subject).toBe(NO_SUBJECT)
    })

    test('is never cut through the middle of an emoji', () => {
      const subject = fields({ subject: '😀'.repeat(SUBJECT_MAX_LENGTH + 1) })?.subject ?? ''

      expect(subject).toBe(`${'😀'.repeat(SUBJECT_MAX_LENGTH - 1)}…`)
    })
  })

  describe('studentName', () => {
    test(`is kept at ${String(NAME_MAX_LENGTH)} characters`, () => {
      const fromName = 'n'.repeat(NAME_MAX_LENGTH)

      expect(fields({ fromName })?.studentName).toBe(fromName)
    })

    test('is dropped, not cut, when longer', () => {
      expect(fields({ fromName: 'n'.repeat(NAME_MAX_LENGTH + 1) })?.studentName).toBeNull()
    })

    test('is none when absent or blank', () => {
      expect(fields({ fromName: null })?.studentName).toBeNull()
      expect(fields({ fromName: '  ' })?.studentName).toBeNull()
    })

    test('does not refuse the email when dropped', () => {
      expect(fields({ fromName: 'n'.repeat(10_000) })).not.toBeNull()
    })
  })

  describe('Message-ID', () => {
    test(`is kept at ${String(MESSAGE_ID_MAX_LENGTH)} characters`, () => {
      // `<` + 243 + `@mail>`: exactly the cap.
      const messageId = `<${'m'.repeat(MESSAGE_ID_MAX_LENGTH - 7)}@mail>`
      expect(messageId).toHaveLength(MESSAGE_ID_MAX_LENGTH)

      expect(fields({ messageId })?.emailMessageId).toBe(messageId)
    })

    test('is none, never an empty string, when missing', () => {
      expect(fields({ messageId: '' })?.emailMessageId).toBeNull()
      expect(fields({ messageId: '  ' })?.emailMessageId).toBeNull()
    })

    test(`is none when longer than ${String(MESSAGE_ID_MAX_LENGTH)} characters`, () => {
      expect(
        fields({ messageId: `<${'m'.repeat(MESSAGE_ID_MAX_LENGTH)}>` })?.emailMessageId,
      ).toBeNull()
      // Past the cap in characters and far past it in bytes: the case that
      // overflowed the unique index when the cap was 998.
      expect(
        fields({ messageId: `<${'文'.repeat(MESSAGE_ID_MAX_LENGTH)}>` })?.emailMessageId,
      ).toBeNull()
    })

    test.each([
      ['a CR/LF, which could add a header to our replies', '<x@y>\r\nBcc: attacker@evil.test'],
      ['a bare LF', '<x@y>\nBcc: attacker@evil.test'],
      ['a space', '<x y@mail>'],
      ['a quote', '<"x"@mail>'],
      ['a NUL', '<x\u0000@mail>'],
      ['a tab', '<x\t@mail>'],
      ['no angle brackets', 'x@mail'],
      ['two IDs', '<a@mail><b@mail>'],
      ['nested brackets', '<<x@mail>>'],
    ])('is none when it holds %s', (_, messageId) => {
      expect(fields({ messageId })?.emailMessageId).toBeNull()
    })

    test('keeps the characters a real one uses', () => {
      const messageId = '<CAMCzHj20xbw+=Sq_9.-a$b@mail.gmail.com>'

      expect(fields({ messageId })?.emailMessageId).toBe(messageId)
    })

    test('does not refuse the email when none', () => {
      expect(fields({ messageId: '' })).not.toBeNull()
      expect(fields({ messageId: '<x@y>\r\nBcc: attacker@evil.test' })).not.toBeNull()
    })
  })

  describe('NUL characters', () => {
    test('are stripped from the subject, name and text, and the email kept', () => {
      const stored = fields({
        subject: 'Cannot\u0000 log in',
        fromName: 'Maya\u0000 Chen',
        text: 'Help\u0000 me',
      })

      expect(stored).toMatchObject({
        subject: 'Cannot log in',
        studentName: 'Maya Chen',
        body: 'Help me',
      })
    })
  })

  describe('message text', () => {
    test(`is kept whole at ${String(INBOUND_TEXT_MAX_LENGTH)} characters`, () => {
      const text = 't'.repeat(INBOUND_TEXT_MAX_LENGTH)

      expect(fields({ text })?.body).toBe(text)
    })

    test('keeps its beginning and says it was shortened when longer', () => {
      const text = `New words first.\n${'> quoted history\n'.repeat(10_000)}`

      const body = fields({ text })?.body ?? ''

      expect(length(body)).toBe(INBOUND_TEXT_MAX_LENGTH)
      expect(body).toStartWith('New words first.')
      expect(body).toEndWith(TEXT_SHORTENED)
    })

    test('is a placeholder when the email had no plain text', () => {
      expect(fields({ text: '' })?.body).toBe(NO_TEXT)
      expect(fields({ text: '\n  \n' })?.body).toBe(NO_TEXT)
    })
  })
})
