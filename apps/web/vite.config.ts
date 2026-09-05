import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Watchtower calls the API on its own origin and lets the dev server forward
 * `/v1` to it. That keeps the API free of a CORS configuration it would only
 * need for local development, and keeps the API host out of the bundle.
 */
const API_PROXY = {
  '/v1': {
    target: process.env['ORBIT_API_URL'] ?? 'http://127.0.0.1:3002',
    changeOrigin: false,
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    strictPort: true,
    proxy: API_PROXY,
  },
  // The same proxy in preview, so a built Watchtower behaves like the dev one.
  preview: {
    port: 3000,
    strictPort: true,
    proxy: API_PROXY,
  },
});
