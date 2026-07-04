// One-off inspection script to understand the chatbot + whatsapp widgets on a site.
const { chromium } = require('playwright');

const URL = process.argv[2] || 'https://keyahomes.in';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  console.log('Loading', URL);
  const resp = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  console.log('HTTP status:', resp && resp.status());
  await page.waitForTimeout(8000); // let JS widgets inject

  // WhatsApp links
  const waLinks = await page.$$eval('a[href*="wa.me"], a[href*="api.whatsapp"], a[href*="whatsapp"]',
    els => els.map(e => ({ href: e.href, text: (e.innerText || '').trim().slice(0, 40) })));
  console.log('\n=== WhatsApp links ===');
  console.log(JSON.stringify(waLinks, null, 2));

  // iframes (chat widgets often live in an iframe)
  const frames = page.frames().map(f => ({ name: f.name(), url: f.url() }));
  console.log('\n=== Frames ===');
  console.log(JSON.stringify(frames, null, 2));

  // Elements whose text/attributes hint at chat
  const chatCandidates = await page.evaluate(() => {
    const hits = [];
    const all = document.querySelectorAll('*');
    for (const el of all) {
      const hay = (
        (el.id || '') + ' ' + (el.className && el.className.toString ? el.className.toString() : '') + ' ' +
        (el.getAttribute && (el.getAttribute('aria-label') || '')) + ' ' +
        (el.getAttribute && (el.getAttribute('title') || ''))
      ).toLowerCase();
      if (/chat|bot|assistant|message|intercom|tawk|crisp|drift|kommunicate|botpress|wati|gallabox|landbot/.test(hay)) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          hits.push({
            tag: el.tagName.toLowerCase(),
            id: el.id || null,
            cls: (el.className && el.className.toString ? el.className.toString() : '').slice(0, 80),
            aria: el.getAttribute('aria-label') || null,
            text: (el.innerText || '').trim().slice(0, 40) || null,
          });
        }
      }
    }
    // dedupe
    const seen = new Set();
    return hits.filter(h => { const k = JSON.stringify(h); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 40);
  });
  console.log('\n=== Chat-related visible elements ===');
  console.log(JSON.stringify(chatCandidates, null, 2));

  // All script srcs (to identify vendor)
  const scripts = await page.$$eval('script[src]', els => els.map(e => e.src).filter(s =>
    /chat|bot|widget|intercom|tawk|crisp|drift|kommunicate|botpress|wati|gallabox|landbot|embed/i.test(s)));
  console.log('\n=== Chat-vendor script srcs ===');
  console.log(JSON.stringify([...new Set(scripts)], null, 2));

  console.log('\n=== Console errors ===');
  console.log(JSON.stringify(consoleErrors.slice(0, 10), null, 2));

  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
