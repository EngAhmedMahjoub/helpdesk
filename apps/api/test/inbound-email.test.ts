import { describe, expect, test } from 'bun:test'
import { parseInboundEmail, type ReceivedEmail } from '../src/email/inbound.ts'
import newEmail from './payloads/resend/new-email.json'
import replyOneReference from './payloads/resend/reply-one-reference.json'
import replySeveralReferences from './payloads/resend/reply-several-references.json'

// Saved from Resend's received-emails API: the structure and header formats of
// real Gmail emails to the helpdesk, with the people and words replaced.
const saved = {
  newEmail: newEmail as ReceivedEmail,
  replyOneReference: replyOneReference as ReceivedEmail,
  replySeveralReferences: replySeveralReferences as ReceivedEmail,
}

/** A saved payload with some headers replaced, for the cases no saved one covers. */
function withHeaders(headers: Record<string, string>): ReceivedEmail {
  return { ...saved.newEmail, headers: { ...saved.newEmail.headers, ...headers } }
}

describe('parseInboundEmail', () => {
  test('reads a new email', () => {
    expect(parseInboundEmail(saved.newEmail)).toEqual({
      fromAddress: 'maya.chen@uni.edu',
      fromName: 'Maya Chen',
      subject: 'Cannot log in',
      text: 'I reset my password but the portal still says it is wrong.\n',
      messageId: '<CAMaya01first@mail.gmail.com>',
      inReplyTo: null,
      references: [],
    })
  })

  test('reads a reply whose References holds one ID', () => {
    const email = parseInboundEmail(saved.replyOneReference)

    expect(email.messageId).toBe('<CAMaya02second@mail.gmail.com>')
    expect(email.inReplyTo).toBe('<CAMaya01first@mail.gmail.com>')
    expect(email.references).toEqual(['<CAMaya01first@mail.gmail.com>'])
  })

  test('reads a reply whose References Resend gives as a JSON array', () => {
    const email = parseInboundEmail(saved.replySeveralReferences)

    expect(email.inReplyTo).toBe(
      '<010601a0d24197b2-04e91003-8ec7-4ef0-bf17-7169979f798e-000000@ap-northeast-1.amazonses.com>',
    )
    expect(email.references).toEqual([
      '<CAMaya01first@mail.gmail.com>',
      '<CAMaya02second@mail.gmail.com>',
      '<010601a0d24197b2-04e91003-8ec7-4ef0-bf17-7169979f798e-000000@ap-northeast-1.amazonses.com>',
    ])
  })

  test('keeps the quoted history in the text', () => {
    const email = parseInboundEmail(saved.replyOneReference)

    expect(email.text).toStartWith('It happens on my phone too.')
    expect(email.text).toContain('> I reset my password')
  })

  test('reads References in the raw space-separated form too', () => {
    const email = parseInboundEmail(withHeaders({ references: '<a@mail> <b@mail>\r\n <c@mail>' }))

    expect(email.references).toEqual(['<a@mail>', '<b@mail>', '<c@mail>'])
  })

  test('finds headers whatever their case', () => {
    const { headers } = saved.replyOneReference
    const email = parseInboundEmail({
      ...saved.newEmail,
      headers: {
        From: headers?.from ?? '',
        'In-Reply-To': headers?.['in-reply-to'] ?? '',
        References: headers?.references ?? '',
      },
    })

    expect(email.fromName).toBe('Maya Chen')
    expect(email.inReplyTo).toBe('<CAMaya01first@mail.gmail.com>')
    expect(email.references).toEqual(['<CAMaya01first@mail.gmail.com>'])
  })

  test.each([
    ['a quoted name', '"Chen, Maya" <maya.chen@uni.edu>', 'Chen, Maya'],
    ['a bare address', 'maya.chen@uni.edu', null],
    ['an address in brackets alone', '<maya.chen@uni.edu>', null],
    ['an empty quoted name', '"" <maya.chen@uni.edu>', null],
  ])('reads the display name from %s', (_, from, name) => {
    expect(parseInboundEmail(withHeaders({ from })).fromName).toBe(name)
  })

  test('has no display name when there is no From header', () => {
    expect(parseInboundEmail({ ...saved.newEmail, headers: null }).fromName).toBeNull()
  })

  test('takes the address out of a From field that carries a name', () => {
    const email = parseInboundEmail({ ...saved.newEmail, from: 'Maya Chen <maya.chen@uni.edu>' })

    expect(email.fromAddress).toBe('maya.chen@uni.edu')
  })

  test('gives an empty text for an email with no plain-text part', () => {
    const email = parseInboundEmail({ ...saved.newEmail, text: null, html: '<p>Hello</p>' })

    expect(email.text).toBe('')
  })
})
