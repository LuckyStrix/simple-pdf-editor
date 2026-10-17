import { defineConfig } from 'vite';

// Relative base so the build works from file:// (Electron) and from a sub-path (GitHub Pages).
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
});
