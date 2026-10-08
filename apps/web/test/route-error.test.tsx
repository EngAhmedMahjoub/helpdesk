import { afterEach, expect, spyOn, test } from 'bun:test'
import { screen } from '@testing-library/react'
import * as sentry from '../src/lib/sentry.ts'
import { ApiError } from '../src/lib/api.ts'
import { renderRoute, responds, stubApi } from './helpers.tsx'

const reported = spyOn(sentry, 'reportError').mockImplementation(() => {})

afterEach(() => {
  reported.mockClear()
})

test('a page that throws while rendering shows the fallback and reports the error', async () => {
  // React logs the error it caught; the assertions below are what matter.
  const quiet = spyOn(console, 'error').mockImplementation(() => {})
  stubApi({
    '/auth/me': responds.currentUser,
    // Not the shape the dashboard reads: its counts are missing, so it throws.
    '/dashboard': () => Response.json({}),
    '/tickets': responds.noTickets,
  })

  try {
    renderRoute('/')

    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Back to the dashboard' })).toBeDefined()
    expect(reported).toHaveBeenCalledTimes(1)
    expect(reported.mock.calls[0]![0]).toBeInstanceOf(TypeError)
  } finally {
    quiet.mockRestore()
  }
})

test('drops an ApiError, which the screen or the API already deals with', () => {
  const event = { type: undefined }

  expect(sentry.scrubEvent(event, { originalException: new ApiError(500, 'Boom') })).toBeNull()
  expect(sentry.scrubEvent(event, { originalException: new TypeError('x') })).toBe(event)
})

test('strips the query string from the page URL and from breadcrumbs', () => {
  const event = sentry.scrubEvent({
    type: undefined,
    request: { url: 'https://app.example.com/tickets?search=sam@student.example', headers: {} },
  })
  const crumb = sentry.scrubBreadcrumb({
    category: 'navigation',
    data: { from: '/tickets?search=sam', to: '/tickets/7' },
  })

  expect(event?.request).toEqual({ url: 'https://app.example.com/tickets' })
  expect(crumb?.data).toEqual({ from: '/tickets', to: '/tickets/7' })
  expect(sentry.scrubBreadcrumb({ category: 'console', message: 'caught: sam' })).toBeNull()
})
