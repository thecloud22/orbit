import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3001,
    strictPort: true,
  },
  // vite preview defaults to 4173; the portal must answer on 3001 in both
  // dev and preview so http://localhost:3001/requests is a stable target.
  preview: {
    port: 3001,
    strictPort: true,
  },
});
