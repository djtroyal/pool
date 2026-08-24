import { expect, test } from '@playwright/test';

const uniqueName = (prefix: string) => `${prefix}${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;
const uniqueSingleCharacter = (project: string, offset = 0) => {
  const projectBase = { chromium: 0x20000, firefox: 0x23000, touch: 0x26000, webkit: 0x29000 }[project] ?? 0x2c000;
  return String.fromCodePoint(projectBase + ((Date.now() + offset) % 0x2fff));
};

test('practice optimizer loads a recommendation without auto-striking', async ({ page }, testInfo) => {
  test.setTimeout(35_000);
  await page.goto('/');
  await page.getByLabel('Your name').fill(uniqueName(`O${testInfo.project.name[0]}`));
  await page.getByRole('button', { name: 'Practice' }).click();
  await page.locator('.optimizer-menu > summary').click();
  await page.getByLabel('Optimizer quality').selectOption('fast');
  await page.getByRole('button', { name: 'Find best shot' }).click();
  await expect(page.getByRole('button', { name: 'Cancel search' })).toBeVisible();
  await expect(page.locator('.optimizer-result-overlay.primary-ready')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.optimizer-result-overlay')).toContainText('OPTIMIZED SHOT READY');
  await expect(page.locator('.strike-velocity-value > span')).not.toHaveText('50');
  await expect(page.locator('.pocketed-tray .pocketed-ball')).toHaveCount(0);
  await expect(page).toHaveTitle(/Optimized:/);
  await page.getByRole('button', { name: 'Shot aids' }).click();
  await page.getByLabel('Potted pocket').check();
  await expect.poll(async () => Number(await page.locator('canvas.pool-canvas').getAttribute('data-potted-pocket-count'))).toBeGreaterThan(0);
});

test('opens the procedural practice table', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Create room' })).toBeVisible();
  await expect(page.getByText(/Call the line/i)).toHaveCount(0);
  await page.getByLabel('Your name').fill(uniqueName(`P${testInfo.project.name[0]}`));
  await page.getByRole('button', { name: 'Practice' }).click();
  await expect(page.locator('.match-label')).toContainText('PRACTICE');
  await expect(page.locator('canvas.pool-canvas')).toBeVisible();
  await expect(page.locator('.table-stage')).toHaveAttribute('data-trajectory-ready', 'true');
  await expect(page.locator('canvas.pool-canvas')).toHaveAttribute('data-trajectory-painted', 'true');
  await expect(page.locator('canvas.pool-canvas')).toHaveAttribute('data-object-path-color', /^#[\da-f]{6}$/i);
  await expect.poll(async () => Number(await page.locator('canvas.pool-canvas').getAttribute('data-trajectory-segments'))).toBeGreaterThan(0);
  await expect.poll(async () => Number(await page.locator('canvas.pool-canvas').getAttribute('data-trajectory-markers'))).toBeGreaterThan(0);
  await expect(page.locator('img')).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel('Strike angle compass')).toHaveAttribute('aria-valuenow', '1');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.strike-velocity-value > span')).toHaveText('51');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.getByLabel('Strike angle compass')).toHaveAttribute('aria-valuenow', '1.1');
  if (testInfo.project.name !== 'touch') {
    const table = await page.locator('canvas.pool-canvas').boundingBox();
    if (!table) throw new Error('Table was not measurable');
    const center = { x: table.x + table.width * .5, y: table.y + table.height * .5 };
    await page.mouse.move(center.x, center.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(center.x - 55, center.y, { steps: 3 });
    await expect(page.locator('.strike-velocity-value > span')).not.toHaveText('51');
    await page.mouse.down({ button: 'left' });
    await page.mouse.up({ button: 'left' });
    await page.mouse.up({ button: 'right' });
    await expect(page.locator('.strike-velocity-value > span')).toHaveText('51');

    const strike = await page.locator('.velocity-triangle').boundingBox();
    if (!strike) throw new Error('Strike control was not measurable');
    const strikeCenter = { x: strike.x + strike.width / 2, y: strike.y + strike.height * .7 };
    await page.mouse.move(strikeCenter.x, strikeCenter.y);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(strikeCenter.x, strikeCenter.y - 38, { steps: 3 });
    await expect(page.locator('.strike-velocity-value > span')).not.toHaveText('51');
    await page.mouse.down({ button: 'right' });
    await page.mouse.up({ button: 'right' });
    await page.mouse.up({ button: 'left' });
    await expect(page.locator('.strike-velocity-value > span')).toHaveText('51');
    await expect(page.getByRole('button', { name: /Undo/ })).toBeDisabled();
  }
  await page.getByRole('button', { name: /^STRIKE/ }).click();
  await expect(page.getByRole('button', { name: /Undo/ })).toBeEnabled({ timeout: 45_000 });
});

test('two guests can enter and start a private room', async ({ browser }, testInfo) => {
  const contextOptions = testInfo.project.name === 'touch'
    ? { hasTouch: true, isMobile: true, viewport: { width: 740, height: 360 } }
    : {};
  const hostContext = await browser.newContext(contextOptions);
  const guestContext = await browser.newContext(contextOptions);
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  await host.goto('/');
  const hostName = uniqueName(`A${testInfo.project.name[0]}`);
  await host.getByLabel('Your name').fill(hostName);
  await host.getByRole('button', { name: /Create room/i }).click();
  await expect(host.getByRole('heading', { name: 'Room settings' })).toBeVisible();
  const code = (await host.locator('.room-code strong').textContent())!.trim();

  await guest.goto(`/room/${code}`);
  await expect(guest.locator('.room-row', { hasText: hostName }).first()).toContainText('Code only');
  await guest.getByLabel('Your name').fill(uniqueName(`M${testInfo.project.name[0]}`));
  await guest.getByRole('button', { name: 'Join room' }).click();
  await expect(guest.getByRole('heading', { name: 'Room settings' })).toBeVisible();

  await host.getByRole('button', { name: 'Mark ready' }).click();
  await guest.getByRole('button', { name: 'Mark ready' }).click();
  await host.getByRole('button', { name: /Start game/i }).click();
  await expect(host.locator('canvas.pool-canvas')).toBeVisible();
  await expect(guest.locator('canvas.pool-canvas')).toBeVisible();

  const playerStrip = await host.evaluate(() => {
    const header = document.querySelector('.game-header')!.getBoundingClientRect();
    const scoreboard = document.querySelector('.scoreboard')!.getBoundingClientRect();
    const avatar = document.querySelector('.scoreboard .avatar-medium')!.getBoundingClientRect();
    return { headerHeight: header.height, scoreboardHeight: scoreboard.height, avatarSize: avatar.width };
  });
  expect(playerStrip.headerHeight).toBeGreaterThanOrEqual(54);
  expect(playerStrip.scoreboardHeight).toBeGreaterThanOrEqual(48);
  expect(playerStrip.avatarSize).toBeGreaterThanOrEqual(40);

  const hostHasTurn = (await host.locator('.match-label strong').textContent())?.includes('YOUR TURN') ?? false;
  const shooter = hostHasTurn ? host : guest;
  const observer = hostHasTurn ? guest : host;
  await expect(shooter).toHaveTitle(/● YOUR TURN/);
  await expect(shooter.getByLabel('Strike angle compass')).toBeEnabled();
  await expect(shooter.locator('.ball-group-badge')).toHaveCount(2);
  await expect(shooter.locator('.ball-group-badge').first()).toContainText('OPEN TABLE');
  await expect(shooter.locator('.velocity-triangle')).toBeVisible();
  await expect(shooter.locator('.strike-button.explicit-strike')).toBeVisible();
  await expect(shooter.locator('.strike-velocity-value > span')).toHaveText('50');
  await shooter.getByRole('button', { name: /Shot aids/i }).click();
  await expect(shooter.locator('.trajectory-aid-list input:checked')).toHaveCount(2);
  await expect(shooter.getByLabel('Advanced Cue Path', { exact: true })).not.toBeChecked();
  await expect(shooter.getByLabel('Simple Object Path', { exact: true })).toBeChecked();
  await expect(shooter.getByLabel('Advanced Object Path', { exact: true })).not.toBeChecked();
  await expect(shooter.getByLabel('Potted pocket', { exact: true })).not.toBeChecked();
  await shooter.getByLabel('Potted pocket', { exact: true }).check();
  await expect(shooter.getByLabel('Potted pocket', { exact: true })).toBeChecked();
  await expect(shooter.getByLabel('Simple Object Path', { exact: true })).toBeChecked();
  await expect(shooter.getByLabel('Rail continuations')).not.toBeChecked();
  await expect(shooter.getByLabel('Jump arc / landing')).toBeChecked();
  await shooter.getByLabel('Advanced Object Path', { exact: true }).check();
  await expect(shooter.getByLabel('Simple Object Path', { exact: true })).not.toBeChecked();
  await shooter.getByLabel('Simple Object Path', { exact: true }).check();
  await expect(shooter.getByLabel('Advanced Object Path', { exact: true })).not.toBeChecked();
  await shooter.getByRole('button', { name: /Shot aids/i }).click();
  await expect(shooter.locator('.table-stage')).toHaveAttribute('data-trajectory-ready', 'true');
  await expect(shooter.locator('canvas.pool-canvas')).toHaveAttribute('data-trajectory-painted', 'true');
  const table = await shooter.locator('canvas.pool-canvas').boundingBox();
  if (!table) throw new Error('Table was not measurable');
  const placementX = table.x + table.width * 0.22;
  const placementY = table.y + table.height * 0.5;
  if (testInfo.project.name === 'touch') {
    await shooter.locator('canvas.pool-canvas').tap({ position: { x: table.width * 0.22, y: table.height * 0.5 } });
  } else {
    await shooter.mouse.move(placementX, placementY);
    await expect(shooter.locator('.table-stage')).toHaveAttribute('data-cue-placement-preview', 'true');
    await shooter.mouse.click(placementX, placementY);
  }
  await expect(shooter.getByRole('button', { name: /^STRIKE/ })).toBeEnabled();
  await shooter.getByRole('button', { name: /^STRIKE/ }).click();
  await expect(observer.getByText('Balls in motion…')).toBeVisible();

  await hostContext.close();
  await guestContext.close();
});

test('table, pocket row, and full controls fit the viewport without page scrolling', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByLabel('Your name').fill(uniqueName(`L${testInfo.project.name[0]}`));
  await page.getByRole('button', { name: 'Practice' }).click();
  await expect(page.locator('.table-stage')).toBeVisible();
  for (const viewport of [{ width: 1366, height: 768 }, { width: 1600, height: 1000 }]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const stage = document.querySelector('.table-stage')!.getBoundingClientRect();
      const tray = document.querySelector('.pocketed-tray')!.getBoundingClientRect();
      const controls = document.querySelector('.cue-panel')!.getBoundingClientRect();
      return {
        documentHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight,
        stageTrayGap: Math.abs(tray.top - stage.bottom),
        controlsBottom: controls.bottom,
        controlsHeight: controls.height,
        controlsRight: controls.right,
        stageLeft: stage.left
      };
    });
    expect(layout.documentHeight).toBeLessThanOrEqual(layout.viewportHeight);
    expect(layout.stageTrayGap).toBeLessThanOrEqual(1);
    expect(layout.controlsBottom).toBeLessThanOrEqual(layout.viewportHeight);
    expect(layout.controlsHeight).toBeGreaterThan(viewport.height * 0.7);
    expect(Math.abs(layout.controlsRight - layout.stageLeft)).toBeLessThanOrEqual(1);
  }
});

test('avatar studio previews, edits, undoes, and persists vector parts', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByLabel('Your name').fill(uniqueName(`V${testInfo.project.name[0]}`));
  await page.getByRole('button', { name: 'Practice' }).click();
  await page.getByRole('button', { name: 'Exit' }).click();
  await page.locator('.profile-chip').click();
  await page.locator('.progression-tabs button').filter({ hasText: /^avatar$/i }).click();
  await expect(page.locator('.avatar-builder-studio')).toBeVisible();
  await expect(page.locator('.avatar-preview-stage .avatar-face')).toBeVisible();
  await page.locator('.avatar-group-tabs button').filter({ hasText: /^hair$/i }).click();
  await page.locator('.avatar-parts button').filter({ hasText: /^curls$/i }).click();
  await expect(page.locator('.avatar-save-status')).toContainText('Unsaved changes');
  await page.getByRole('button', { name: 'Undo avatar change' }).click();
  await expect(page.locator('.avatar-save-status')).toContainText('Up to date');
  await page.locator('.avatar-parts button').filter({ hasText: /^curls$/i }).click();
  await page.getByRole('button', { name: 'Save avatar' }).click();
  await expect(page.locator('.avatar-save-status')).toContainText(/Saved|Up to date/);
});

test('an open room can be joined from the live room list with one-character names', async ({ browser }, testInfo) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  await host.goto('/');
  const hostName = uniqueSingleCharacter(testInfo.project.name);
  await host.getByLabel('Your name').fill(hostName);
  await host.getByRole('button', { name: 'Open' }).click();
  await host.getByRole('button', { name: /Create room/i }).click();

  await guest.goto('/');
  const guestName = uniqueSingleCharacter(testInfo.project.name, 97);
  await guest.getByLabel('Your name').fill(guestName);
  const row = guest.locator('.room-row').filter({
    has: guest.locator('.room-row-main > strong').filter({ hasText: new RegExp(`^${hostName}$`) })
  }).filter({ has: guest.getByRole('button', { name: 'Join', exact: true }) });
  await expect(row).toContainText('open');
  await row.getByRole('button', { name: 'Join' }).click();
  await expect(guest.getByRole('heading', { name: 'Room settings' })).toBeVisible();

  await hostContext.close();
  await guestContext.close();
});
