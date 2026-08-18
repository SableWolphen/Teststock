import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // GitHub Pages serves this project at /Teststock/. Vercel/dev stay at root.
  base: mode === 'github-pages' ? '/Teststock/' : '/',
}));
