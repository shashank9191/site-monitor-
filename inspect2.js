// Drive the bzai chatbot: open it, send a message, capture how the reply renders.
const { chromium } = require('playwright');
const URL = process.argv[2] || 'https://keyahomes.in';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(6000);

  // Open the widget
  await page.click('#bzai-chat-toggle').catch(e => console.log('toggle click failed', e.message));
  await page.waitForTimeout(1500);

  // Describe the input + form structure
  const formInfo = await page.evaluate(() => {
    const form = document.querySelector('#bzai-chat-form');
    if (!form) return null;
    const input = form.querySelector('input, textarea');
    return {
      inputTag: input && input.tagName.toLowerCase(),
      inputType: input && input.getAttribute('type'),
      inputPlaceholder: input && input.getAttribute('placeholder'),
      formHTML: form.outerHTML.slice(0, 400),
    };
  });
  console.log('=== Form ===\n', JSON.stringify(formInfo, null, 2));

  // Snapshot body before sending
  const bodyBefore = await page.$eval('#bzai-chat-body', el => el.innerHTML.length).catch(() => -1);

  // Count message-like children before
  const beforeCount = await page.evaluate(() => {
    const body = document.querySelector('#bzai-chat-body');
    return body ? body.querySelectorAll('div').length : -1;
  });

  // Type a test message and submit
  const inputSel = '#bzai-chat-form input, #bzai-chat-form textarea';
  await page.fill(inputSel, 'Hi, what is the price of a 3 BHK?').catch(e => console.log('fill failed', e.message));
  await page.waitForTimeout(300);
  await page.press(inputSel, 'Enter').catch(() => {});
  console.log('\nMessage sent, waiting for reply...');

  // Poll for the body to grow (bot reply appended)
  let grew = false;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    const len = await page.$eval('#bzai-chat-body', el => el.innerHTML.length).catch(() => -1);
    if (len > bodyBefore + 30) { grew = true; }
    if (i % 3 === 0) console.log(`  t+${i}s bodyLen=${len} (was ${bodyBefore})`);
  }

  // Dump final structure of chat body to learn message bubble classes
  const finalStruct = await page.evaluate(() => {
    const body = document.querySelector('#bzai-chat-body');
    if (!body) return null;
    const msgs = [...body.querySelectorAll('div')].map(d => ({
      cls: d.className || null,
      text: (d.innerText || '').trim().slice(0, 60),
    })).filter(m => m.text);
    return { totalDivs: body.querySelectorAll('div').length, sample: msgs.slice(-12) };
  });
  console.log('\n=== Final chat body structure ===\n', JSON.stringify(finalStruct, null, 2));
  console.log('\nBody grew after send:', grew);

  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
