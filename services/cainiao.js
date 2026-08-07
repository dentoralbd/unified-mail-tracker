let puppeteer;
try {
    puppeteer = require('puppeteer');
} catch (e) {
    puppeteer = require('puppeteer-core');
}

const fs = require('fs');

/**
 * Locate Chromium or Edge binary on system
 */
function findBrowserExecutable() {
    if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
        return process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    const candidatePaths = [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Users\\User\\AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome-stable'
    ];
    return candidatePaths.find(p => fs.existsSync(p)) || null;
}

/**
 * Scrape pre-BD customs tracking events directly from Cainiao Global
 * @param {string} trackingId 
 * @returns {Promise<Object>}
 */
async function fetchCainiaoTracking(trackingId) {
    const cleanId = (trackingId || '').trim().toUpperCase();
    if (!cleanId) return { found: false, source: 'Cainiao', events: [] };

    console.log(`[CainiaoScraper] Launching headless browser for ${cleanId}...`);
    let browser = null;
    try {
        const launchOptions = {
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-blink-features=AutomationControlled'
            ]
        };

        const sysPath = findBrowserExecutable();
        if (sysPath) {
            launchOptions.executablePath = sysPath;
        } else if (typeof puppeteer.executablePath === 'function') {
            try {
                const autoPath = puppeteer.executablePath();
                if (autoPath && fs.existsSync(autoPath)) {
                    launchOptions.executablePath = autoPath;
                }
            } catch(e) {}
        }

        try {
            browser = await puppeteer.launch(launchOptions);
        } catch (launchErr) {
            if (launchErr.message && launchErr.message.includes('Could not find Chrome')) {
                console.log('[CainiaoScraper] Chrome binary missing on cloud server. Auto-installing Chrome via npx...');
                require('child_process').execSync('npx puppeteer browsers install chrome');
                browser = await puppeteer.launch(launchOptions);
            } else {
                throw launchErr;
            }
        }
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        await page.goto(`https://global.cainiao.com/newDetail.htm?mailNoList=${cleanId}&lang=en-US`, {
            waitUntil: 'networkidle2',
            timeout: 25000
        }).catch(err => console.log(`[CainiaoScraper] Navigation note: ${err.message}`));

        await new Promise(r => setTimeout(r, 4000));

        const events = await page.evaluate(() => {
            const raw = [];
            const text = document.body.innerText || '';
            const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                // Match dates like 2026-08-05 20:42:09 GMT+6 or 2026-07-28 22:17:44
                const dateMatch = line.match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/);
                if (dateMatch) {
                    const date = dateMatch[0];
                    let status = 'Transit Event';
                    let location = 'International Transit';

                    if (i >= 1) {
                        const prevLine = lines[i - 1];
                        if (prevLine.startsWith('Carrier note:')) {
                            status = prevLine.replace('Carrier note:', '').trim();
                            if (i >= 2 && !lines[i - 2].startsWith('Last updated') && !lines[i - 2].startsWith('Refresh')) {
                                const mainStatus = lines[i - 2];
                                if (!mainStatus.includes('Bangladesh') && !mainStatus.includes('Mainland China') && mainStatus.length < 80) {
                                    status = `${mainStatus} / ${status}`;
                                }
                            }
                        } else if (!prevLine.includes('GMT') && prevLine.length < 80) {
                            status = prevLine;
                        }
                    }

                    raw.push({
                        date,
                        location,
                        status,
                        details: status,
                        source: 'CAINIAO',
                        isLocal: false
                    });
                }
            }
            return raw;
        });

        await browser.close().catch(() => {});
        browser = null;

        console.log(`[CainiaoScraper] Successfully extracted ${events.length} pre-BD customs events for ${cleanId}`);

        return {
            found: events.length > 0,
            source: 'CAINIAO',
            carrier: 'Cainiao Global Logistics',
            events
        };

    } catch (e) {
        console.error(`[CainiaoScraper] Error scraping Cainiao for ${cleanId}:`, e.message);
        if (browser) await browser.close().catch(() => {});
        return { found: false, source: 'CAINIAO', error: e.message, events: [] };
    }
}

module.exports = {
    fetchCainiaoTracking
};
