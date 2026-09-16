import { GlobalRegistrator } from '@happy-dom/global-registrator'

// Register DOM globals before anything imports Testing Library: its queries
// bind to document.body at import time.
GlobalRegistrator.register()

const { afterEach } = await import('bun:test')
const { cleanup } = await import('@testing-library/react')

afterEach(cleanup)
