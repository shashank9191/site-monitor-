/**
 * Google Apps Script — trend log for the Site Monitor.
 *
 * SETUP (one time):
 * 1. Create a Google Sheet (e.g. "Site Monitor Log"). Note nothing else needed.
 * 2. Extensions → Apps Script. Paste this whole file, replacing any default code.
 * 3. Click Deploy → New deployment → type "Web app".
 *      - Execute as: Me
 *      - Who has access: Anyone   (it only accepts POSTs; no data is exposed)
 * 4. Copy the Web app URL (ends in /exec).
 * 5. Add it to the monitor:
 *      - GitHub repo → Settings → Secrets → Actions → new secret
 *        SHEETS_WEBHOOK_URL = <that /exec URL>
 *    (or put it in your local .env)
 *
 * Each monitor run appends one row per site, so you can chart uptime %,
 * load-time trends, chatbot health, and SSL days over time.
 */
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Log')
             || SpreadsheetApp.getActiveSpreadsheet().insertSheet('Log');

    // header row on first use
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Run At', 'Project', 'URL', 'Status', 'TTFB (ms)',
                       'Load (ms)', 'WhatsApp', 'Chatbot', 'SSL days', 'www', 'Problems']);
      sheet.setFrozenRows(1);
    }

    (body.rows || []).forEach(function (r) {
      sheet.appendRow([body.runAt, r.project, r.url, r.status, r.ttfbMs,
                       r.loadMs, r.whatsapp, r.chatbot, r.sslDays, r.www, r.problems]);
    });

    return ContentService.createTextOutput(JSON.stringify({ ok: true, added: (body.rows || []).length }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
