import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The backend serves the built app via StaticFiles, so in production everything is
// same-origin and /api resolves naturally. In dev we proxy instead, which keeps the
// app same-origin on localhost -- that matters for microphone access, because
// SpeechRecognition requires a secure context and localhost counts as one.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
