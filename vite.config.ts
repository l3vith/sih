import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig(({ mode }) => ({
  publicDir: mode === 'companion' ? 'companion-public' : 'public',
  plugins: [react(), basicSsl(), VitePWA({ registerType: 'prompt', injectRegister: 'auto', manifest: { name: 'NWIS Field Companion', short_name: 'NWIS Notes', start_url: '/companion.html', display: 'standalone', theme_color: '#294e45', background_color: '#ffffff', icons: [{ src: '/companion-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }] }, workbox: { globPatterns: ['**/*.{js,css,html,svg,woff2}'], maximumFileSizeToCacheInBytes: 6000000, navigateFallback: '/companion.html', navigateFallbackAllowlist: [/^\/companion(?:\.html)?$/], cleanupOutdatedCaches: true } })],
  build: { outDir: mode === 'companion' ? 'dist-companion' : 'dist', rollupOptions: { input: mode === 'companion' ? 'companion.html' : ['index.html', 'companion.html'] } },
  envPrefix: ['VITE_', 'SUPABASE_'],
  worker: { format: 'es' },
  optimizeDeps: { include: ['maplibre-gl'] },
  server: {
    host: true,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
}))
