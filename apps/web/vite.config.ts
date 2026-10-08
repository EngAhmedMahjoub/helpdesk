import path from 'node:path'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Only Vercel's production build has the token, so only it makes source maps
// and uploads them; a local or CI build stays as it was. SENTRY_ORG and
// SENTRY_PROJECT come from the environment beside it.
const uploadSourceMaps = Boolean(process.env.SENTRY_AUTH_TOKEN)

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Last, as the plugin asks, so it sees the final bundle.
    uploadSourceMaps &&
      sentryVitePlugin({
        // The short SHA, the same name the API's events carry for a deploy.
        release: { name: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7), setCommits: false },
        // Uploaded, then deleted, so Vercel never serves the original source.
        sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
        telemetry: false,
      }),
  ],
  build: {
    // Hidden: the bundle carries no sourceMappingURL comment pointing at them.
    sourcemap: uploadSourceMaps ? 'hidden' : false,
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    proxy: {
      // The end-to-end run overrides this to reach the API it started on its
      // own port, rather than whatever a developer has on 3000 — which is
      // pointed at the development database.
      '/api': process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
    },
  },
})
