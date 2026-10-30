import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1, // packaged Electron instances do not coexist reliably
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
})
