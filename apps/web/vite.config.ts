import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
