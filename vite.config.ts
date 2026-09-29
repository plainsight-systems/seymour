/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 700,
  },
  test: {
    // Serve real stylesheet text to tests that import CSS with ?raw (Vitest blanks CSS by default).
    css: true,
  },
});
