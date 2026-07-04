// Site health monitor for the Keya Homes network.
// Per site it checks: uptime, load speed, the WhatsApp click-to-chat button,
// and drives the on-page "bzai" AI chatbot (send a message -> confirm a reply).
// Produces an HTML report and (if SMTP is configured) emails it.
//
// Env vars:
//   SLOW_MS      load time (ms) above which a site is flagged "slow"  (default 6000)
//   CONCURRENCY  how many sites to check in parallel                  (default 3)
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS   SMTP credentials for sending mail
//   MAIL_TO      recipient(s)                                          (default shashank@keyahomes.in)
//   MAIL_FROM    from address                                          (default SMTP_USER)
//   ALWAYS_EMAIL "1" = email every run; otherwise email only when there are issues (default: always)

try { require('dotenv').config(); } catch { /* dotenv optional */ }
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const SITES = require('./sites');

const SLOW_MS = parseInt(process.env.SLOW_MS || '12000', 10);   // full page load
const TTFB_SLOW_MS = parseInt(process.env.TTFB_SLOW_MS || '4000', 10); // server response
// Default to sequential so load-time numbers aren't inflated by bandwidth contention.
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '1', 10);
const NAV_TIMEOUT = 45000;
const CHAT_WAIT_MS = 35000;      // how long to wait for a bot reply
const TEST_MESSAGE = 'Hello, this is an automated website health check. What projects do you have?';

// ---- one site check -------------------------------------------------------
async function checkSite(browser, site) {
  const r = {
    project: site.project,
    url: site.url,
    up: false,
    httpStatus: null,
    ttfbMs: null,
    loadMs: null,
    finalUrl: null,
    slow: false,
    whatsapp: { expected: site.wa, found: null, ok: null },
    chatbot: { present: false, replied: false, replyPreview: null },
    notes: [],
    problems: [],
  };

  const context = await browser.newContext({
    userAgent: 'KeyaHomes-SiteMonitor/1.0 (+automated health check)',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  try {
    // ---- uptime + speed (TTFB = server responsiveness, full load = user experience) ----
    const t0 = Date.now();
    let resp;
    try {
      resp = await page.goto(site.url, { waitUntil: 'commit', timeout: NAV_TIMEOUT });
      r.ttfbMs = Date.now() - t0;
      await page.waitForLoadState('load', { timeout: NAV_TIMEOUT }).catch(() => {});
    } catch (e) {
      // couldn't even connect
      resp = null;
    }
    r.loadMs = Date.now() - t0;
    r.finalUrl = page.url();
    r.httpStatus = resp ? resp.status() : null;
    r.up = !!resp && resp.status() < 400;
    if (!r.up) { r.problems.push(`HTTP ${r.httpStatus || 'no response'}`); return finish(r, context); }

    const slowLoad = r.loadMs > SLOW_MS;
    const slowServer = r.ttfbMs != null && r.ttfbMs > TTFB_SLOW_MS;
    r.slow = slowLoad || slowServer;
    if (slowServer) r.problems.push(`Slow server (TTFB ${(r.ttfbMs / 1000).toFixed(1)}s)`);
    if (slowLoad) r.problems.push(`Slow load: ${(r.loadMs / 1000).toFixed(1)}s`);

    // let JS-injected widgets (chatbot, whatsapp float) settle
    await page.waitForTimeout(6000);

    // ---- WhatsApp button ----
    const waHrefs = await page.$$eval(
      'a[href*="wa.me"], a[href*="api.whatsapp"], a[href*="whatsapp"]',
      els => els.map(e => e.href)
    ).catch(() => []);
    const waNumbers = waHrefs.map(h => (h.match(/(?:phone=|wa\.me\/)(\d+)/) || [])[1]).filter(Boolean);
    r.whatsapp.found = waNumbers[0] || null;
    if (site.wa) {
      r.whatsapp.ok = waNumbers.includes(site.wa);
      if (!r.whatsapp.ok) {
        r.problems.push(r.whatsapp.found
          ? `WhatsApp number mismatch (found ${r.whatsapp.found}, expected ${site.wa})`
          : 'WhatsApp button missing');
      }
    } else {
      // no WhatsApp expected: just report if one happens to be present
      r.whatsapp.ok = null;
      if (r.whatsapp.found) r.notes.push(`WhatsApp present: ${r.whatsapp.found}`);
    }

    // ---- AI chatbot: open, send a message, confirm a reply ----
    await runChatbotTest(page, r);

  } catch (e) {
    r.problems.push(`Error: ${e.message.split('\n')[0].slice(0, 120)}`);
  }
  return finish(r, context);
}

async function finish(r, context) {
  await context.close().catch(() => {});
  return r;
}

async function runChatbotTest(page, r) {
  // widget present?
  const toggle = await page.$('#bzai-chat-toggle');
  if (!toggle) {
    r.problems.push('Chatbot widget not found');
    return;
  }
  r.chatbot.present = true;

  try {
    await toggle.click();
    await page.waitForSelector('#bzai-chat-form input', { timeout: 8000 });

    // how many bot bubbles already exist (greeting etc.)
    const botBefore = await page.$$eval('.bzai-message-bubble.bot', els => els.length).catch(() => 0);

    const inputSel = '#bzai-chat-form input';
    await page.fill(inputSel, TEST_MESSAGE);
    await page.press(inputSel, 'Enter');

    // poll for a NEW bot bubble with real content
    const deadline = Date.now() + CHAT_WAIT_MS;
    while (Date.now() < deadline) {
      await page.waitForTimeout(1000);
      const bubbles = await page.$$eval('.bzai-message-bubble.bot',
        els => els.map(e => (e.innerText || '').trim())).catch(() => []);
      if (bubbles.length > botBefore) {
        const latest = bubbles[bubbles.length - 1];
        if (latest && latest.length > 5) {
          r.chatbot.replied = true;
          r.chatbot.replyPreview = latest.slice(0, 120);
          return;
        }
      }
    }
    r.problems.push('Chatbot did not reply within ' + (CHAT_WAIT_MS / 1000) + 's');
  } catch (e) {
    r.problems.push('Chatbot test failed: ' + e.message.split('\n')[0].slice(0, 80));
  }
}

// ---- run all sites with limited concurrency -------------------------------
async function runPool(browser, sites, size) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < sites.length) {
      const idx = i++;
      const site = sites[idx];
      process.stdout.write(`  checking ${site.url} ...\n`);
      results[idx] = await checkSite(browser, site);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, sites.length) }, worker));
  return results;
}

// ---- report rendering -----------------------------------------------------
function statusCell(ok, label) {
  const color = ok ? '#137333' : '#c5221f';
  const mark = ok ? '✓' : '✗';
  return `<span style="color:${color};font-weight:600">${mark} ${label}</span>`;
}

function renderHtml(results, startedAt) {
  const rows = results.map(r => {
    const upCell = r.up ? statusCell(true, 'Up') : statusCell(false, r.httpStatus ? 'HTTP ' + r.httpStatus : 'Down');
    const ttfbStr = r.ttfbMs == null ? '—' : (r.ttfbMs / 1000).toFixed(1) + 's';
    const loadStr = r.loadMs == null ? '—' : (r.loadMs / 1000).toFixed(1) + 's';
    const speedCell = r.loadMs == null ? '—'
      : `<span style="color:${r.slow ? '#c5221f' : '#137333'}">${loadStr}</span>` +
        `<span style="color:#9aa0a6;font-size:12px"> · ${ttfbStr} ttfb</span>`;
    const waCell = r.whatsapp.expected == null
      ? (r.whatsapp.found ? '✓' : '—')
      : statusCell(!!r.whatsapp.ok, r.whatsapp.ok ? 'OK' : 'Bad');
    const chatCell = !r.chatbot.present ? statusCell(false, 'Missing')
      : (r.chatbot.replied ? statusCell(true, 'Replied') : statusCell(false, 'No reply'));
    const issues = r.problems.length ? r.problems.join('; ') : '';
    const rowBg = r.problems.length ? '#fef7f6' : '#ffffff';
    return `<tr style="background:${rowBg}">
      <td style="padding:8px 10px;border-bottom:1px solid #eee">${r.project}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee"><a href="${r.url}" style="color:#1a73e8;text-decoration:none">${r.url.replace('https://', '')}</a></td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee">${upCell}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:center">${speedCell}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:center">${waCell}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:center">${chatCell}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;color:#c5221f;font-size:13px">${issues}</td>
    </tr>`;
  }).join('');

  const issueCount = results.filter(r => r.problems.length).length;
  const banner = issueCount === 0
    ? `<div style="background:#e6f4ea;color:#137333;padding:14px 18px;border-radius:8px;font-weight:600">✅ All ${results.length} sites healthy</div>`
    : `<div style="background:#fce8e6;color:#c5221f;padding:14px 18px;border-radius:8px;font-weight:600">⚠️ ${issueCount} of ${results.length} sites need attention</div>`;

  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:900px;margin:0 auto;color:#202124">
    <h2 style="margin:0 0 4px">Keya Homes — Site Health Report</h2>
    <div style="color:#5f6368;font-size:13px;margin-bottom:16px">${startedAt}</div>
    ${banner}
    <table style="border-collapse:collapse;width:100%;margin-top:16px;font-size:14px">
      <thead><tr style="background:#f1f3f4;text-align:left">
        <th style="padding:8px 10px">Project</th>
        <th style="padding:8px 10px">Site</th>
        <th style="padding:8px 10px">Uptime</th>
        <th style="padding:8px 10px;text-align:center">Speed</th>
        <th style="padding:8px 10px;text-align:center">WhatsApp</th>
        <th style="padding:8px 10px;text-align:center">Chatbot</th>
        <th style="padding:8px 10px">Issues</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="color:#5f6368;font-size:12px;margin-top:16px">
      Speed flagged above ${(SLOW_MS / 1000)}s · Chatbot tested by sending: "${TEST_MESSAGE}"
    </div>
  </div>`;
}

function renderSubject(results) {
  const issues = results.filter(r => r.problems.length);
  if (issues.length === 0) return `✅ Site Monitor — all ${results.length} sites OK`;
  const names = issues.slice(0, 3).map(r => r.url.replace('https://', '')).join(', ');
  const more = issues.length > 3 ? ` +${issues.length - 3} more` : '';
  return `⚠️ Site Monitor — ${issues.length} issue${issues.length > 1 ? 's' : ''}: ${names}${more}`;
}

function renderText(results) {
  return results.map(r => {
    const bits = [
      r.up ? 'UP' : 'DOWN',
      r.loadMs != null ? (r.loadMs / 1000).toFixed(1) + 's' : '-',
      'chat:' + (!r.chatbot.present ? 'missing' : r.chatbot.replied ? 'ok' : 'noreply'),
    ];
    const probs = r.problems.length ? '  !! ' + r.problems.join('; ') : '';
    return `${r.up && !r.problems.length ? '✓' : '✗'} ${r.url}  [${bits.join(' ')}]${probs}`;
  }).join('\n');
}

// ---- email ----------------------------------------------------------------
async function sendEmail(subject, html, text) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log('\n[email] SMTP not configured — skipping send. (set SMTP_HOST/SMTP_USER/SMTP_PASS)');
    return false;
  }
  let nodemailer;
  try { nodemailer = require('nodemailer'); }
  catch { console.log('[email] nodemailer not installed — run: npm i nodemailer'); return false; }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: parseInt(process.env.SMTP_PORT || '465', 10) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const info = await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: process.env.MAIL_TO || 'shashank@keyahomes.in',
    subject, text, html,
  });
  console.log('[email] sent:', info.messageId);
  return true;
}

// ---- main -----------------------------------------------------------------
(async () => {
  const startedAt = new Date().toString();
  console.log('Site monitor run —', startedAt);
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  let results;
  try {
    results = await runPool(browser, SITES, CONCURRENCY);
  } finally {
    await browser.close();
  }

  const html = renderHtml(results, startedAt);
  const subject = renderSubject(results);
  const text = renderText(results);

  console.log('\n' + subject + '\n');
  console.log(text);

  // always write a local report artifact
  const outDir = path.join(__dirname, 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = startedAt.replace(/[^0-9]/g, '').slice(0, 14);
  fs.writeFileSync(path.join(outDir, `report-${stamp}.html`), html);
  fs.writeFileSync(path.join(outDir, 'latest.html'), html);

  const hasIssues = results.some(r => r.problems.length);
  const alwaysEmail = process.env.ALWAYS_EMAIL !== '0';
  if (alwaysEmail || hasIssues) {
    await sendEmail(subject, html, text).catch(e => console.log('[email] failed:', e.message));
  } else {
    console.log('\n[email] no issues and ALWAYS_EMAIL=0 — not sending.');
  }

  // non-zero exit on issues, handy for CI / schedulers
  process.exit(hasIssues ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
