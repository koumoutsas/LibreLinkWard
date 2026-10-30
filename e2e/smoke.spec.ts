import { expect, test } from '@playwright/test'
import { launchApp } from './helpers'

test('app launches and shows the login screen when signed out', async () => {
  const { app, cleanup } = await launchApp()
  try {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await expect(window.locator('input[type="password"]')).toBeVisible({ timeout: 20_000 })
    await expect(window.locator('button[type="submit"]')).toBeVisible()
  } finally {
    await cleanup()
  }
})
