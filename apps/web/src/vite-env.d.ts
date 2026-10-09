/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the API, e.g. https://api.example.com. Empty in development: the Vite proxy makes /api same-origin. */
  readonly VITE_API_URL?: string
  /** The web project's Sentry DSN. Unset outside production builds, so nothing is reported. */
  readonly VITE_SENTRY_DSN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
