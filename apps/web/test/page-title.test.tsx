import { beforeEach, expect, test } from 'bun:test'
import { renderHook } from '@testing-library/react'
import { appTitle, usePageTitle } from '@/hooks/use-page-title'

beforeEach(() => {
  document.title = appTitle
})

test('sets the page name before the app name', () => {
  renderHook(() => {
    usePageTitle('Tickets')
  })

  expect(document.title).toBe('Tickets · Helpdesk')
})

test('follows a title that changes, as ticket detail does once the ticket loads', () => {
  const { rerender } = renderHook(
    ({ title }) => {
      usePageTitle(title)
    },
    { initialProps: { title: 'Ticket' } },
  )

  rerender({ title: '#42 Library card not working' })

  expect(document.title).toBe('#42 Library card not working · Helpdesk')
})

test('restores the app name when the page goes away', () => {
  const { unmount } = renderHook(() => {
    usePageTitle('Users')
  })

  unmount()

  expect(document.title).toBe('Helpdesk')
})
