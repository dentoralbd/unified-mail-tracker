# Unified International Mail & BD Post Tracker

A unified parcel tracking system and Telegram Bot combining pre-customs international logistics (**ParcelsApp**, **AliExpress**, **Cainiao**) and post-customs domestic delivery (**Bangladesh Post IPS**) into a single, merged timeline.

![Dashboard Preview](public/index.html)

## Features

- 📦 **2-Stage Unified Tracking Engine**:
  - **Stage 1 (Pre-BD Customs)**: Scrapes ParcelsApp & Cainiao using a headless browser engine for origin, transit, linehaul, and airport arrival updates.
  - **Stage 2 (Post-BD Customs)**: Queries Bangladesh Post IPS (`ipsbd.bdpost.gov.bd/app_mail_tracking/search1.php`) for customs clearance, airport sorting, and local delivery updates.
- ⚡ **Multi-Carrier Time-Window Event Merging**:
  - Automatically deduplicates and merges identical/same-day milestone updates from Sunyou, Cainiao, and AliExpress into unified cards (e.g. `Source: SUNYOU, CAINIAO`).
  - Displays events in strict **descending order** (newest update at the top).
- 🤖 **Telegram Bot Integration**:
  - Interactive bot commands: `/start`, `/track <id>`, `/add <id> [label]`, `/list`, `/delete <id>`, `/help`.
  - Automatic background cron worker polling saved packages hourly to push notifications to subscribed Telegram users.
- 🌐 **Modern Web UI Dashboard**:
  - Dark-mode interface with live search, 5-stage progress stepper, parcel watchlist drawer, and sample shortcuts.

---

## Getting Started Locally

1. **Clone the repository**:
   ```bash
   git clone https://github.com/dentoralbd/unified-mail-tracker.git
   cd unified-mail-tracker
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Create a `.env` file in the root directory:
   ```env
   PORT=3000
   TELEGRAM_BOT_TOKEN=8691190145:AAHaW6MocE_b8wy6msUJIpEhNkrZ9VDbYkk
   ```

4. **Start the server**:
   ```bash
   node server.js
   ```
   Open **`http://localhost:3000`** in your browser.

---

## ☁️ Deployment (Cloudflare / Render / Railway)

Because this app utilizes Node.js and headless browser scraping (`puppeteer-core` with Chromium/Edge) to fetch ParcelsApp client-rendered events, it runs best on a Node.js runtime environment.

### Free 24/7 Hosting on Render / Railway:
1. Go to **[Render.com](https://render.com)** or **[Railway.app](https://railway.app)**.
2. Connect your private repository `dentoralbd/unified-mail-tracker`.
3. Set Environment Variable:
   - `TELEGRAM_BOT_TOKEN` = `8691190145:AAHaW6MocE_b8wy6msUJIpEhNkrZ9VDbYkk`
4. Click **Deploy**.

For Cloudflare Tunnel setup, refer to [`DEPLOYMENT.md`](DEPLOYMENT.md).
