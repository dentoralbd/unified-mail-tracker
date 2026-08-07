# Unified Mail Tracker - Deployment & Cloud Hosting Guide

This guide explains how to deploy the application to GitHub in a private repository and host it live.

---

## 1. Telegram Bot Configuration

1. Create a bot on Telegram via **[@BotFather](https://t.me/BotFather)**:
   - Send `/newbot`
   - Name your bot (e.g., `AliExpress BD Mail Tracker`)
   - Choose a username ending in `bot` (e.g., `bd_mail_tracker_bot`)
   - Copy the API HTTP Token provided by BotFather.

2. Set the token in your environment variables:
   ```env
   PORT=3000
   TELEGRAM_BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ
   ```

3. The bot will automatically populate its menu buttons (`/track`, `/add`, `/list`, `/delete`, `/help`) in Telegram upon startup.

---

## 2. GitHub Private Repository Setup

Initialize Git and push your project to a private repository:

```bash
git init
git add .
git commit -m "Initial commit: Unified International & BD Post Mail Tracker"
gh repo create unified-mail-tracker --private --source=. --remote=origin --push
```

---

## 3. Cloud Hosting & Cloudflare Deployment

Because this app utilizes Node.js and headless browser scraping (`puppeteer-core` with Chromium/Edge) to fetch ParcelsApp client-rendered events, it runs best on a Node.js runtime environment.

### Option A: Cloudflare Tunnel (Recommended for Custom Domains)
Run the app on your server/computer and route it securely through Cloudflare on your own domain:
1. Install `cloudflared`: `winget install Cloudflare.cloudflared`
2. Authenticate: `cloudflared tunnel login`
3. Expose port 3000 to your Cloudflare domain:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```

### Option B: 24/7 Free Cloud Hosting (Render / Railway / Koyeb)
1. Push to GitHub Private Repository (Step 2 above).
2. Go to **[Render.com](https://render.com)** or **[Railway.app](https://railway.app)**.
3. Select **New Web Service** -> Connect your private GitHub repository `unified-mail-tracker`.
4. Set Build & Start Commands:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Add Environment Variable:
   - `TELEGRAM_BOT_TOKEN` = `your_bot_token_from_botfather`
6. Click **Deploy**. Render/Railway will host your live site 24/7 with a free SSL domain!
