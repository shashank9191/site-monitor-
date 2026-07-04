# Keya Homes — Site Monitor

Twice-a-day health check for the whole website network. For each site it verifies:

| Check | What it does |
|-------|--------------|
| **Uptime** | Loads the page, confirms it responds with HTTP < 400 |
| **Speed** | Measures server response (TTFB) and full page load; flags slow sites |
| **WhatsApp** | Confirms the click-to-chat button is present and points to the correct number |
| **AI chatbot** | Opens the "Chat with us" widget, sends a message, and confirms the bot replies |

Results are compiled into an HTML report and emailed to `shashank@keyahomes.in`.

## Sites monitored (13)

Keya Homes · ATL (×2) · TUF (×3) · TLT (×3) · SPRING (×3) · LBL — edit [`sites.js`](sites.js) to add/remove.

## Run it locally

```bash
npm install
npx playwright install chromium
cp .env.example .env        # then fill in the Gmail App Password
npm start
```

Without `.env`, it still runs and prints a summary + writes `reports/latest.html` — it just skips the email.

## Email setup

`keyahomes.in` is Google Workspace, so sending uses a **Gmail App Password**:

1. Turn on 2-Step Verification for shashank@keyahomes.in
2. Create an App Password at https://myaccount.google.com/apppasswords
3. Put it in `.env` (local) or GitHub Secrets (cloud) as `SMTP_PASS`

## Cloud schedule (twice daily)

A GitHub Actions workflow is included at [`.github/workflows/monitor.yml`](.github/workflows/monitor.yml).
It runs at **09:00 and 15:00 IST** and emails the report. Set these repo secrets:
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_TO`, `MAIL_FROM`.

## Tuning

Environment variables (see `.env.example`): `SLOW_MS`, `TTFB_SLOW_MS`, `CONCURRENCY`, `ALWAYS_EMAIL`.

## Utilities

- `inspect.js <url>` — dump chat/WhatsApp widgets on a page
- `probe.js <url...>` — measure TTFB + full load, sequentially
