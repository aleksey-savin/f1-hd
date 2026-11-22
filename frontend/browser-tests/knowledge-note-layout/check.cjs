// Run manually: node frontend/browser-tests/knowledge-note-layout/check.cjs
// Requires Playwright Chromium. Uses real note components; no application server or database.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
(async () => {
  const { createServer } = await import('vite');
  const { default: config } = await import('./vite.config.mjs');
  const server = await createServer(config({ command: 'serve', mode: 'test' }));
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    for (const width of [320, 390, 768, 1280]) {
      for (const mode of ['read', 'edit']) {
        const page = await browser.newPage({ viewport: { width, height: 900 },
          isMobile: width < 768, hasTouch: width < 768,
          ...(width < 768 ? { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' } : {}),
        });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/api/**', route => route.fulfill({ json: { companies: [], users: [], categories: [] } }));
        await page.goto(server.resolvedUrls.local[0] + (mode === 'edit' ? '?edit=1' : ''));
        const tables = page.locator('.toastui-editor-contents table:visible');
        await tables.first().waitFor();
        await page.locator('.toastui-editor-contents img:visible').first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.locator('article').evaluate(el => getComputedStyle(el).minWidth), '0px', 'application utility styles must be loaded');
        const metrics = await page.locator('.kb-doc').evaluate(root => ({
          viewport: innerWidth, page: document.documentElement.scrollWidth,
          width: root.clientWidth, content: root.scrollWidth,
        }));
        assert.ok(metrics.content <= metrics.width + 1, `${width}/${mode}: note overflows ${JSON.stringify(metrics)}`);
        assert.ok(metrics.page <= width + 1, `${width}/${mode}: page exceeds viewport`);
        for (const table of await tables.all()) {
          const scroll = await table.evaluate(el => {
            el.scrollLeft = el.scrollWidth;
            return { max: el.scrollWidth - el.clientWidth, left: el.scrollLeft,
              last: el.querySelector('tr:last-child td:last-child')?.getBoundingClientRect().right,
              right: el.getBoundingClientRect().right };
          });
          assert.ok(scroll.max <= 1 || scroll.left > 0, `${width}/${mode}: wide table cannot scroll`);
          assert.ok(scroll.last <= scroll.right + 2, `${width}/${mode}: last column is unreachable`);
        }
        assert.deepEqual(errors, []);
        if (process.env.KB_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.KB_SCREENSHOTS, `${mode}-${width}.png`) });
        await page.close();
        console.log(`PASS ${width}px ${mode}: note fits and last table column is reachable`);
      }
    }
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
