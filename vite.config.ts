import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  envPrefix: ['VITE_', 'SUPABASE_'],
  worker: { format: 'es' },
  optimizeDeps: { include: ['maplibre-gl'] },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
})
