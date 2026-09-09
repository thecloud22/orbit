import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Meridian Home Lending — the loan origination system Orbit underwrites against.
 *
 * Port 3030, clear of the Phase 1 demo portal (3001), the library portal (3020),
 * and of 3010/3102, which the Watchtower end-to-end stack reserves.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 3030, strictPort: true },
  preview: { port: 3030, strictPort: true },
});
