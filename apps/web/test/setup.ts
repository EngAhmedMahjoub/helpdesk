import { GlobalRegistrator } from '@happy-dom/global-registrator'

// From .env.test, which `bun test` loads. No default on purpose, the way
// src/env.ts has none for WEB_ORIGIN: a missing value would otherwise leave the
// DOM on about:blank and fail every API call with "Invalid URL" halfway through
// the suite, instead of saying what is wrong here.
const url = process.env.WEB_ORIGIN

if (!url) {
  throw new Error('WEB_ORIGIN is not set. apps/web/.env.test provides it for `bun test`.')
}

// Register DOM globals before anything imports Testing Library: its queries
// bind to document.body at import time.
//
// url matters as much as the globals. about:blank, the default, is not a valid
// base for resolving a relative URL, and axios reads location.origin at import
// to decide whether a request is same-origin — so every call to /api/… threw
// before the request was even built.
GlobalRegistrator.register({ url })

const { afterEach } = await import('bun:test')
const { cleanup } = await import('@testing-library/react')

afterEach(cleanup)
