import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The SPA is served under /media; the UI controller rewrites this base when mounted elsewhere.
  base: '/media/',
  // CSS-referenced assets (the kit's bundled fonts) load relative to the stylesheet: the controller
  // rewrites the `/media/` base in index.html only, so an absolute `/media/assets/…` font URL
  // inside the CSS would 404 once the console is mounted anywhere else.
  experimental: {
    renderBuiltUrl: (_file, { hostType }) => (hostType === 'css' ? { relative: true } : undefined),
  },
  build: {
    outDir: 'dist/spa',
    emptyOutDir: true,
    rollupOptions: {
      // `index.html` is the production SPA entry; `preview.html` is an additive standalone
      // mock-data entry used only for visual verification without a backend.
      input: {
        index: resolve(__dirname, 'index.html'),
        preview: resolve(__dirname, 'preview.html'),
      },
    },
  },
});
