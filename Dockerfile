FROM node:20-slim

# Install system dependencies & Chromium for Puppeteer headless scraping
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    ca-certificates \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Hugging Face Spaces runs as user with UID 1000
RUN useradd -m -u 1000 user

WORKDIR /app

RUN chown -R user:user /app

# Tell Puppeteer to use the installed Debian Chromium and default to HF port 7860
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PORT=7860 \
    NODE_ENV=production

USER user

# Copy package definitions and install production dependencies
COPY --chown=user:user package*.json ./
RUN npm install --omit=dev --ignore-scripts

# Copy application source code
COPY --chown=user:user . .

# Ensure data directory exists with correct user permissions
RUN mkdir -p data

EXPOSE 7860

CMD ["node", "server.js"]
