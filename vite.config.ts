/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));

function getBuildDate(): string {
  try {
    return execSync('git log -1 --format=%cd --date=format:%Y-%m-%d', {
      encoding: 'utf8',
      timeout: 3000,
    }).trim();
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(getBuildDate()),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
});
