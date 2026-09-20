import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Everything must be self-hosted: no CDN font or script requests at runtime.
  build: { target: 'es2022', assetsInlineLimit: 0 },
  worker: { format: 'es' },
  server: { port: 5173 },
});
