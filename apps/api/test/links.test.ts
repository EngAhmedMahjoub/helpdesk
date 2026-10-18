import { describe, expect, test } from 'bun:test'
import { domainOf, linkHost, unknownLink } from '../src/ai/links.ts'

describe('linkHost', () => {
  test.each([
    ['https://help.academy.example/verify?x=1', 'help.academy.example'],
    ['http://academy.example:8080/a', 'academy.example'],
    ['www.academy.example/a', 'academy.example'],
    ['academy.example/claim', 'academy.example'],
    ['support@helpdesk.example.com', 'helpdesk.example.com'],
  ])('reads %s as %s', (token, host) => {
    expect(linkHost(token)).toBe(host)
  })
})

describe('domainOf', () => {
  test.each([
    ['Helpdesk Support <support@helpdesk.example.com>', 'helpdesk.example.com'],
    ['support@Helpdesk.Example.com', 'helpdesk.example.com'],
  ])('reads the domain of %s', (sender, domain) => {
    expect(domainOf(sender)).toBe(domain)
  })
})

describe('unknownLink', () => {
  const known = { hosts: ['helpdesk.example.com'], addresses: [] }

  test('allows a subdomain of a known host', () => {
    expect(unknownLink('See https://app.helpdesk.example.com/x.', known)).toBeUndefined()
  })

  test('refuses a host that only ends in the same letters', () => {
    // A suffix match without the dot would take this for the academy's.
    expect(unknownLink('See https://evilhelpdesk.example.com/x.', known)).toBe(
      'https://evilhelpdesk.example.com/x',
    )
  })
})
