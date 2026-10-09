import { initSentry } from '@/lib/sentry'

// Imported first by main.tsx, so an error while the app loads is caught too.
// The DSN and the release are fixed at build time; release is injected by the
// Sentry Vite plugin when the build uploads source maps.
const dsn = import.meta.env.VITE_SENTRY_DSN
if (dsn) initSentry({ dsn, environment: import.meta.env.MODE })
