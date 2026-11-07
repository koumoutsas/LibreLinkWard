import { expect, test } from '@playwright/test'
import { launchApp } from './helpers'

test('app launches and shows the language picker on first run', async () => {
  const { app, cleanup } = await launchApp()
  try {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await expect(window.getByRole('radio', { name: 'English' })).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 })
    await window.getByRole('button', { name: 'Continue' }).click()
    await expect(window.getByRole('button', { name: 'Add patient' })).toBeVisible()
  } finally {
    await cleanup()
  }
})
