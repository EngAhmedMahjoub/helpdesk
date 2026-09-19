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

// The suite's floor: no test reaches the network. Put back after every test,
// so a stub one test installs with stubApi never answers the next.
//
// A query dispatched as a test ends can land after that test has put its stub
// away. With the real fetch underneath, that became a connection attempt to the
// dev server port and an ECONNREFUSED printed from nowhere in particular; here
// it is a rejected promise React Query swallows, and if one ever does surface
// the message says what happened.
const offline = (() =>
  Promise.reject(
    new Error('A test requested the network. Stub fetch with stubApi, or await the request.'),
  )) as unknown as typeof fetch

globalThis.fetch = offline

const { afterEach } = await import('bun:test')
const { cleanup } = await import('@testing-library/react')

afterEach(cleanup)
afterEach(() => {
  globalThis.fetch = offline
})
