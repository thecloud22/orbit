import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { libraryApiPlugin } from './src/server/api-plugin';

export default defineConfig({
  plugins: [react(), tailwindcss(), libraryApiPlugin()],
  server: {
    port: 3020,
    strictPort: true,
  },
  // vite preview defaults to 4173; the portal must answer on 3020 in both dev
  // and preview. Pinned clear of the Phase 1 demo portal (3001) and of 3010 and
  // 3102, which the Watchtower end-to-end stack reserves — it was on 3010, so
  // running `pnpm dev` made `pnpm test:e2e:watchtower` unrunnable, and before
  // the stack learned to refuse an occupied port it silently drove this portal
  // instead of Watchtower.
  preview: {
    port: 3020,
    strictPort: true,
  },
});
