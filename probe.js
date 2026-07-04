// Measure TTFB and full-load time sequentially (no contention) for given URLs.
const { chromium } = require('playwright');
const urls = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  for (const url of urls) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const t0 = Date.now();
    let status, ttfb;
    try {
      const resp = await page.goto(url, { waitUntil: 'commit', timeout: 45000 });
      ttfb = Date.now() - t0;
      status = resp && resp.status();
      // continue to full load
      await page.waitForLoadState('load', { timeout: 45000 }).catch(() => {});
    } catch (e) {
      console.log(`${url}  ERROR ${e.message.split('\n')[0]}`);
      await ctx.close(); continue;
    }
    const full = Date.now() - t0;
    // redirect target?
    const finalUrl = page.url();
    console.log(`${url}  status=${status}  TTFB=${ttfb}ms  fullLoad=${full}ms  final=${finalUrl}`);
    await ctx.close();
  }
  await browser.close();
})();
