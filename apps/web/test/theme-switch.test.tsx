import { afterEach, beforeEach, expect, test } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import ThemeSwitch from '@/components/theme-switch'

/** A prefers-color-scheme the test can flip, standing in for the OS setting. */
function stubSystemTheme(dark: boolean) {
  const listeners = new Set<() => void>()
  const media = {
    get matches() {
      return dark
    },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }
  window.matchMedia = (() => media) as unknown as typeof window.matchMedia
  return {
    change(next: boolean) {
      dark = next
      listeners.forEach((listener) => {
        listener()
      })
    },
  }
}

function isDark() {
  return document.documentElement.classList.contains('dark')
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
})

afterEach(() => {
  localStorage.clear()
})

test('with no stored choice it follows the system, and keeps following it', () => {
  const system = stubSystemTheme(true)

  render(<ThemeSwitch />)

  expect(screen.getByRole('button', { name: 'System' }).getAttribute('aria-pressed')).toBe('true')
  expect(isDark()).toBe(true)
  system.change(false)
  expect(isDark()).toBe(false)
})

test('a stored choice wins over the system', () => {
  stubSystemTheme(true)
  localStorage.setItem('theme', 'light')

  render(<ThemeSwitch />)

  expect(screen.getByRole('button', { name: 'Light' }).getAttribute('aria-pressed')).toBe('true')
  expect(isDark()).toBe(false)
})

test('choosing Dark applies it, persists it, and stops following the system', async () => {
  const system = stubSystemTheme(false)

  render(<ThemeSwitch />)
  await userEvent.setup().click(screen.getByRole('button', { name: 'Dark' }))

  expect(isDark()).toBe(true)
  expect(localStorage.getItem('theme')).toBe('dark')
  system.change(false)
  expect(isDark()).toBe(true)
})

test('choosing System clears the stored choice', async () => {
  stubSystemTheme(false)
  localStorage.setItem('theme', 'dark')

  render(<ThemeSwitch />)
  await userEvent.setup().click(screen.getByRole('button', { name: 'System' }))

  expect(localStorage.getItem('theme')).toBeNull()
  expect(isDark()).toBe(false)
})
