/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));

function getGitDate(format: string): string {
  try {
    return execSync(`git log -1 --format=%cd --date=format:${format}`, {
      encoding: 'utf8',
      timeout: 3000,
    }).trim();
  } catch {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    if (format === '%Y%m%d%H%M%S') {
      return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    }
    return d.toISOString().split('T')[0];
  }
}

export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(getGitDate('%Y-%m-%d')),
    __BUILD_VERSION__: JSON.stringify(getGitDate('%Y%m%d%H%M%S')),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
});
