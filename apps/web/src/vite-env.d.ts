/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the API, e.g. https://api.example.com. Empty in development: the Vite proxy makes /api same-origin. */
  readonly VITE_API_URL?: string
  /** The web project's Sentry DSN. Unset outside production builds, so nothing is reported. */
  readonly VITE_SENTRY_DSN?: string
}

/** The web app's package version, from vite.config.ts. */
declare const __APP_VERSION__: string
/** Short SHA of the commit Vercel built; null in a build without one, such as development. */
declare const __APP_COMMIT__: string | null

interface ImportMeta {
  readonly env: ImportMetaEnv
}
