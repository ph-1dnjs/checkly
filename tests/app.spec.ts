import { expect, test } from '@playwright/test'

test('renders the initial application screen', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Checkly' })).toBeVisible()
})
