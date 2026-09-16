import { afterEach, expect, test } from 'bun:test'
import { render, screen } from '@testing-library/react'
import App from '../src/App.tsx'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('shows the API and database status from /api/health', async () => {
  globalThis.fetch = (() =>
    Promise.resolve(
      Response.json({ status: 'ok', database: 'up', timestamp: '2026-01-01T00:00:00.000Z' }),
    )) as unknown as typeof fetch

  render(<App />)

  const status = await screen.findByText(/API status: ok/)
  expect(status.textContent).toContain('database: up')
})
