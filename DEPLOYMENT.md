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

### Option B: 24/7 Free Hosting on Hugging Face Spaces (Recommended - 16 GB RAM, 0 Hours Limit)

Hugging Face Spaces provides **2 vCPU, 16 GB RAM** and **unlimited runtime** for free Docker apps:

1. Go to **[huggingface.co/new-space](https://huggingface.co/new-space)**.
2. Space settings:
   - **Space name**: `unified-mail-tracker` (or your choice)
   - **License**: `mit` (or choose open source)
   - **Select the Space SDK**: **Docker** -> choose **Blank**
   - **Space Hardware**: **CPU Basic (2 vCPU · 16 GB RAM · Free)**
   - **Visibility**: **Public** (recommended for free hosting) or **Private**
3. Add Environment Variable / Secret:
   - Go to **Settings** > **Variables and secrets**
   - Add **New Secret**:
     - Name: `TELEGRAM_BOT_TOKEN`
     - Value: `your_bot_token_from_botfather`
4. Connect GitHub or push your repository:
   - **Method A (Git Push to Space)**:
     ```bash
     git remote add space https://huggingface.co/spaces/<your-hf-username>/unified-mail-tracker
     git push space main
     ```
   - **Method B (GitHub Action)**: Sync automatically from GitHub to Hugging Face on every commit.
5. Hugging Face will automatically build your Docker container, start Chromium headless scraping, and launch your bot + web dashboard on port `7860`!

### Option C: Cloudflare Tunnel (Local PC / Server)
Run the app on your server/computer and route it securely through Cloudflare on your own domain:
1. Install `cloudflared`: `winget install Cloudflare.cloudflared`
2. Authenticate: `cloudflared tunnel login`
3. Expose port 3000 to your Cloudflare domain:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```

### Option D: Render.com / Railway
1. Push to GitHub.
2. Create **New Web Service** and connect repository.
3. Build command: `npm install`, Start command: `npm start`.

