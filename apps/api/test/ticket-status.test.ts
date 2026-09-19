import { describe, expect, test } from 'bun:test'
import { AUTO_CLOSE_AFTER_MS, statusChange } from '../src/tickets/status.ts'

const now = new Date('2026-09-19T10:00:00.000Z')

describe('statusChange', () => {
  test('setting Resolved starts the timer: autoCloseAt is 14 days on', () => {
    expect(statusChange('resolved', now)).toEqual({
      status: 'resolved',
      autoCloseAt: new Date('2026-10-03T10:00:00.000Z'),
    })
  })

  test('setting Open clears the timer', () => {
    expect(statusChange('open', now)).toEqual({ status: 'open', autoCloseAt: null })
  })

  test('setting Closed clears the timer', () => {
    expect(statusChange('closed', now)).toEqual({ status: 'closed', autoCloseAt: null })
  })

  test('the timer is fourteen days', () => {
    expect(AUTO_CLOSE_AFTER_MS).toBe(14 * 24 * 60 * 60 * 1000)
  })

  test('counts from the current time when none is given', () => {
    const before = Date.now()
    const { autoCloseAt } = statusChange('resolved')
    const after = Date.now()

    expect(autoCloseAt?.getTime()).toBeGreaterThanOrEqual(before + AUTO_CLOSE_AFTER_MS)
    expect(autoCloseAt?.getTime()).toBeLessThanOrEqual(after + AUTO_CLOSE_AFTER_MS)
  })
})
