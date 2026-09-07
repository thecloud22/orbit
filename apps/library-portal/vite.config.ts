import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3010,
    strictPort: true,
  },
  // vite preview defaults to 4173; the portal must answer on 3010 in both
  // dev and preview — pinned away from the Phase 1 demo portal at 3001 (and
  // its neighbors) so both can run at once.
  preview: {
    port: 3010,
    strictPort: true,
  },
});
