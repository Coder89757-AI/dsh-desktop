import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    // Copy dictionaries read the packaged brand projection, which a locally
    // branded checkout would otherwise leak into every user-facing assertion.
    // Point the lookup at a path that never exists so tests always read the
    // shipped identity, exactly as an unbranded build does.
    env: {
      DSH_DESKTOP_BRANDING_PATH: '/nonexistent/desktop-branding.json',
    },
    globalSetup: process.platform === 'win32' ? ['../scripts/prepare-test-electron.mjs'] : [],
    // This patched host package is exercised with a mocked node:fs/promises.
    // Keep it in Vitest's module graph so the builtin mock reaches its imports.
    server: {
      deps: {
        inline: ['@deepseek-ai/dsh-host-directory-picker-browse'],
      },
    },
    // Profile integration tests create a full package-junction closure; higher
    // Windows file concurrency makes their latency depend on NTFS/Defender load.
    maxWorkers: process.platform === 'win32' ? 2 : undefined,
  },
})
