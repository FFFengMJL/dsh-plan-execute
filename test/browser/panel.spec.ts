import { expect, test, type Page } from '@playwright/test'

const trigger = (page: Page) => page.getByRole('button', { name: 'Execution options', exact: true })
const panel = (page: Page) => page.getByRole('dialog')

async function openPanel(page: Page) {
  await page.goto('/')
  const clip = page.locator('[data-fixture-clip]')
  await expect(clip).toBeVisible()
  // The fixture must actually clip its children, or it cannot catch regressions.
  expect(await clip.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
  await trigger(page).click()
  const dialog = panel(page)
  await expect(dialog).toBeVisible()
  return dialog
}

async function expectInsideViewport(page: Page, dialog: ReturnType<typeof panel>) {
  const box = await dialog.boundingBox()
  const viewport = page.viewportSize()
  expect(box).not.toBeNull()
  expect(viewport).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(11)
  expect(box!.y).toBeGreaterThanOrEqual(11)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width - 11)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height - 11)
}

test('the panel escapes the clipped card and stays inside the viewport', async ({ page }) => {
  const dialog = await openPanel(page)
  expect(await dialog.evaluate(element => element.parentElement === document.body)).toBe(true)
  await expectInsideViewport(page, dialog)

  const boxes = page.getByRole('combobox')
  await boxes.first().selectOption('["p","m1"]')
  await boxes.nth(1).selectOption('high')
  await page.getByRole('button', { name: 'Save these settings' }).click()
  await expect(page.getByText('Saved; waiting for approval')).toBeVisible()

  const staged = await page.evaluate(() => (window as unknown as { __fixture: { lastStage: unknown } }).__fixture.lastStage)
  expect(staged).toMatchObject({
    mode: 'keep',
    selection: { provider: 'p', model: 'm1', reasoningEffort: 'high' },
  })

  await page.screenshot({ path: 'test/browser/artifacts/panel-desktop.png' })
})

test('a short viewport keeps every control reachable by scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 })
  const dialog = await openPanel(page)
  await expectInsideViewport(page, dialog)

  const scrollable = await dialog.evaluate(element => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }))
  expect(scrollable.clientHeight).toBeLessThanOrEqual(360 - 24 + 1)

  await page.getByRole('button', { name: 'Save these settings' }).scrollIntoViewIfNeeded()
  await page.getByRole('button', { name: 'Save these settings' }).click()
  await expect(page.getByText('Saved; waiting for approval')).toBeVisible()
  await page.screenshot({ path: 'test/browser/artifacts/panel-short.png' })
})

test('a narrow viewport clamps width and never overflows horizontally', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 })
  const dialog = await openPanel(page)
  await expectInsideViewport(page, dialog)

  const box = await dialog.boundingBox()
  expect(box!.width).toBeLessThanOrEqual(360 - 24 + 1)

  await page.getByRole('combobox').first().selectOption('["p","m3"]')
  await page.getByRole('button', { name: 'Save these settings' }).scrollIntoViewIfNeeded()
  const overflow = await dialog.evaluate(element => element.scrollWidth - element.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  await page.screenshot({ path: 'test/browser/artifacts/panel-narrow.png' })
})

test('Escape closes the dialog and returns focus to the trigger', async ({ page }) => {
  await openPanel(page)
  await page.keyboard.press('Escape')
  await expect(panel(page)).toBeHidden()
  await expect(trigger(page)).toBeFocused()
})

test('a pointer down outside the panel closes it', async ({ page }) => {
  await openPanel(page)
  await page.mouse.click(20, 560)
  await expect(panel(page)).toBeHidden()
})

test('the preset group stages a saved target without approving it', async ({ page }) => {
  await page.goto('/')
  const group = page.getByRole('group', { name: 'Presets' })
  await expect(group).toBeVisible()

  const compact = page.getByRole('button', { name: /Compact, then run/ })
  await expect(compact).toHaveAttribute('aria-disabled', 'false')
  const styles = await compact.evaluate(element => {
    const style = getComputedStyle(element)
    return { fontSize: Number.parseFloat(style.fontSize) }
  })
  expect(styles.fontSize).toBeGreaterThanOrEqual(12)
  const border = await group.evaluate(element => getComputedStyle(element).borderTopWidth)
  expect(Number.parseFloat(border)).toBeGreaterThan(0)

  await compact.click()
  await expect(page.getByText(/Staged: compact history, then execute/)).toBeVisible()
  const staged = await page.evaluate(() => (window as unknown as { __fixture: { lastStage: unknown } }).__fixture.lastStage)
  expect(staged).toMatchObject({
    mode: 'compact',
    selection: { provider: 'p', model: 'm3' },
  })
  await page.screenshot({ path: 'test/browser/artifacts/panel-presets.png' })
})

test('the preset group stays inside a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 })
  await page.goto('/')
  const group = page.getByRole('group', { name: 'Presets' })
  await expect(group).toBeVisible()
  await expect(page.locator('.dpe-quick').first()).toBeHidden()
  await expect(page.getByRole('button', { name: 'Execution options', exact: true })).toBeVisible()

  const box = await group.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(360)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)

  await page.getByRole('button', { name: 'Execution options', exact: true }).click()
  const dialog = panel(page)
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: /Compact, then run/ })).toBeVisible()
  await dialog.getByRole('button', { name: /Compact, then run/ }).click()
  await expect(dialog.getByText('Saved; waiting for approval')).toBeVisible()
  const staged = await page.evaluate(() => (window as unknown as { __fixture: { lastStage: unknown } }).__fixture.lastStage)
  expect(staged).toMatchObject({ mode: 'compact', selection: { provider: 'p', model: 'm3' } })
  await page.screenshot({ path: 'test/browser/artifacts/panel-presets-narrow.png' })
})

test('the preset group stays legible in a narrower card', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 600 })
  await page.goto('/')
  const group = page.getByRole('group', { name: 'Presets' })
  await expect(group).toBeVisible()
  const more = page.getByRole('button', { name: 'Execution options', exact: true })
  await expect(more).toContainText('Options')
  await expect(page.getByRole('button', { name: /Compact, then run/ })).toBeVisible()

  const groupBox = await group.boundingBox()
  const stripBox = await page.locator('.strip').boundingBox()
  expect(groupBox).not.toBeNull()
  expect(stripBox).not.toBeNull()
  expect(groupBox!.x + groupBox!.width).toBeLessThanOrEqual(stripBox!.x + stripBox!.width)
  await page.screenshot({ path: 'test/browser/artifacts/panel-presets-medium.png' })
})
