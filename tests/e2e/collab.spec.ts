import { test, expect, type BrowserContext, type Page } from '@playwright/test';

// Dev-login gives us a known "devuser" without needing real OAuth. Each
// browser context gets its own cookie jar, so two contexts = two concurrent
// session cookies for the same underlying user (which is enough to exercise
// the cross-client CRDT path).
async function signIn(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto('/auth/dev-login');
  await page.waitForURL(/\//);
  return page;
}

test.describe('collaborative editing', () => {
  test('two users see each other\'s chat messages', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await signIn(ctx1);
    const p2 = await signIn(ctx2);

    // p1 creates a unique room.
    const name = `e2e-chat-${Date.now()}`;
    await p1.getByPlaceholder('Untitled project…').fill(name);
    await p1.getByRole('button', { name: 'Create room' }).click();
    await p1.getByRole('link', { name: 'Open →' }).first().click();
    await p1.waitForURL(/\/room\//);

    const roomUrl = p1.url();
    await p2.goto(roomUrl);

    // Both peers wait for the WS to report "connected".
    await expect(p1.getByText(/connected/i)).toBeVisible();
    await expect(p2.getByText(/connected/i)).toBeVisible();

    // Open chat in both windows and wait for each to render its empty state so
    // the sidebar DOM definitely exists before p1 sends.
    await p1.getByRole('button', { name: /^Chat/ }).click();
    await expect(p1.getByText(/No messages yet/)).toBeVisible();
    await p2.getByRole('button', { name: /^Chat/ }).click();
    await expect(p2.getByText(/No messages yet/)).toBeVisible();

    const greeting = `hello from p1 ${Date.now()}`;
    await p1.getByPlaceholder('Message…').fill(greeting);
    await p1.getByRole('button', { name: 'send' }).click();

    // p2 should see the message via Yjs sync within a second or two.
    await expect(p2.getByText(greeting)).toBeVisible({ timeout: 10_000 });

    await ctx1.close();
    await ctx2.close();
  });

  test('code execution output is visible to all peers', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await signIn(ctx1);
    const p2 = await signIn(ctx2);

    const name = `e2e-run-${Date.now()}`;
    await p1.getByPlaceholder('Untitled project…').fill(name);
    await p1.getByRole('button', { name: 'Create room' }).click();
    await p1.getByRole('link', { name: 'Open →' }).first().click();
    await p1.waitForURL(/\/room\//);

    const roomUrl = p1.url();
    await p2.goto(roomUrl);

    await expect(p1.getByText(/connected/i)).toBeVisible();
    await expect(p2.getByText(/connected/i)).toBeVisible();

    // Type into Monaco on p1. Monaco renders to canvas/DOM hybrid; focusing
    // the editor + keyboard.type reaches its input correctly.
    await p1.locator('.monaco-editor').first().click();
    await p1.keyboard.type('console.log("hello from e2e")');

    // Wait briefly so the Yjs update + debounce settles.
    await p1.waitForTimeout(500);

    // Click Run on p1.
    await p1.getByRole('button', { name: /Run/ }).click();

    // Both peers should see the output in their run panel.
    await expect(p1.locator('pre').filter({ hasText: 'hello from e2e' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(p2.locator('pre').filter({ hasText: 'hello from e2e' })).toBeVisible({
      timeout: 15_000,
    });

    await ctx1.close();
    await ctx2.close();
  });
});
