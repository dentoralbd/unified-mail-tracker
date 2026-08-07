let puppeteer;
try {
    puppeteer = require('puppeteer');
} catch (e) {
    puppeteer = require('puppeteer-core');
}

const fs = require('fs');

/**
 * Locate Chromium or Edge binary on system (Windows & Linux Cloud containers)
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
 * Normalize text for deduplication matching
 */
function normalizeText(str) {
    if (!str) return '';
    return str.toLowerCase()
        .replace(/[^a-z0-9]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Extract normalized YYYY-MM-DD from various date strings
 */
function getNormalizedDateKey(dateStr) {
    if (!dateStr) return 'NODATE';
    try {
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) {
            return d.toISOString().substring(0, 10);
        }
    } catch(e) {}
    const match = dateStr.match(/\d{1,4}[-\/\. \t]+[a-zA-Z0-9]+[-\/\. \t]+\d{1,4}/);
    return match ? match[0] : dateStr.substring(0, 10);
}

/**
 * Parse various date formats (DD-MM-YYYY HH:MM:SS, DD Mon YYYY HH:MM, ISO) to timestamp
 */
function parseEventTimestamp(dateStr) {
    if (!dateStr) return 0;
    const str = String(dateStr).trim();

    const bdMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
    if (bdMatch) {
        const day = bdMatch[1].padStart(2, '0');
        const month = bdMatch[2].padStart(2, '0');
        const year = bdMatch[3];
        const hh = (bdMatch[4] || '00').padStart(2, '0');
        const mm = (bdMatch[5] || '00').padStart(2, '0');
        const ss = (bdMatch[6] || '00').padStart(2, '0');
        
        const iso = `${year}-${month}-${day}T${hh}:${mm}:${ss}`;
        const t = new Date(iso).getTime();
        if (!isNaN(t)) return t;
    }

    const t = new Date(str).getTime();
    if (!isNaN(t)) return t;

    return 0;
}

/**
 * Merge and deduplicate events collected across multiple couriers
 * @param {Array} rawEvents 
 * @returns {Array} Cleaned, merged, deduplicated events sorted chronologically descending (newest first)
 */
function mergeAndDeduplicateEvents(rawEvents) {
    if (!rawEvents || rawEvents.length === 0) return [];

    const items = rawEvents.map(ev => ({
        ...ev,
        timestamp: parseEventTimestamp(ev.date)
    }));

    items.sort((a, b) => b.timestamp - a.timestamp);

    const merged = [];

    items.forEach(ev => {
        const matchIndex = merged.findIndex(m => {
            const timeDiff = Math.abs(m.timestamp - ev.timestamp);
            const sameDay = getNormalizedDateKey(m.date) === getNormalizedDateKey(ev.date);

            if (timeDiff <= 5 * 60 * 1000 && m.isLocal === ev.isLocal) return true;

            if (sameDay && timeDiff <= 3 * 3600 * 1000 && (m.isLocal === ev.isLocal)) {
                const s1 = normalizeText(m.status || m.details);
                const s2 = normalizeText(ev.status || ev.details);
                if (s1.includes('depart') || s2.includes('depart') || s1.includes('left') || s2.includes('left') ||
                    s1.includes('arrived') || s2.includes('arrived') || s1.includes('port') || s2.includes('port') ||
                    s1.includes('hub') || s2.includes('hub') || s1.includes('linehaul') || s2.includes('linehaul') ||
                    s1.includes('sorting') || s2.includes('sorting') || s1.includes('transit') || s2.includes('transit')) {
                    return true;
                }
            }
            return false;
        });

        if (matchIndex >= 0) {
            const existing = merged[matchIndex];

            const existingSources = existing.source.split(', ').map(s => s.trim());
            if (ev.source && !existingSources.includes(ev.source)) {
                existingSources.push(ev.source);
                existing.source = existingSources.join(', ');
            }

            const norm1 = normalizeText(existing.details);
            const norm2 = normalizeText(ev.details);
            if (norm1 !== norm2 && !norm1.includes(norm2) && !norm2.includes(norm1)) {
                existing.details = `${existing.details} / ${ev.details}`;
            } else if (ev.details.length > existing.details.length) {
                existing.details = ev.details;
            }

            if (!existing.location || existing.location === 'International Transit') {
                if (ev.location && ev.location !== 'International Transit') {
                    existing.location = ev.location;
                }
            }
        } else {
            merged.push({
                timestamp: ev.timestamp,
                date: ev.date,
                location: ev.location || 'International Transit',
                status: ev.status || 'In Transit',
                details: ev.details || ev.status || 'Transit Update',
                source: ev.source || 'ParcelsApp',
                isLocal: ev.isLocal || false
            });
        }
    });

    return merged;
}

/**
 * Fetch pre-BD customs international tracking details from ParcelsApp via Network Response Interceptor & Headless Browser
 * @param {string} trackingId 
 * @returns {Promise<Object>}
 */
async function fetchInternationalTracking(trackingId) {
    const cleanId = (trackingId || '').trim().toUpperCase();
    if (!cleanId) {
        return { found: false, source: 'ParcelsApp', events: [] };
    }

    console.log(`[ParcelsAppScraper] Launching headless browser for ${cleanId}...`);

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

        browser = await puppeteer.launch(launchOptions);
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        let interceptedData = null;
        let interceptedCarrier = 'International Courier';

        // Intercept ParcelsApp internal API responses (/api/v2/parcels)
        page.on('response', async (res) => {
            const url = res.url();
            if (url.includes('/api/v2/parcels') || url.includes('/api/v1/parcels')) {
                try {
                    const json = await res.json();
                    if (json && (json.states || json.events)) {
                        interceptedData = json;
                        console.log(`[ParcelsAppScraper] Intercepted ParcelsApp API JSON payload (${(json.states || []).length} states)`);
                    }
                } catch(e) {}
            }
        });

        try {
            await page.goto(`https://parcelsapp.com/en/tracking/${cleanId}`, {
                waitUntil: 'domcontentloaded',
                timeout: 15000
            });
        } catch (gotoErr) {
            console.log(`[ParcelsAppScraper] Navigation note for ${cleanId}: ${gotoErr.message}`);
        }

        // Wait for API payload interception (max 5 seconds)
        for (let i = 0; i < 10; i++) {
            if (interceptedData && Array.isArray(interceptedData.states) && interceptedData.states.length > 0) break;
            await new Promise(r => setTimeout(r, 500));
        }

        let rawEvents = [];

        // If API response was intercepted, extract directly from API JSON
        if (interceptedData && Array.isArray(interceptedData.states) && interceptedData.states.length > 0) {
            const carriers = interceptedData.couriers || interceptedData.carriers || [];
            
            rawEvents = interceptedData.states.map(st => {
                let dateStr = st.date || st.time;
                if (dateStr && dateStr.includes('T')) {
                    try {
                        const d = new Date(dateStr);
                        dateStr = d.toISOString().replace('T', ' ').substring(0, 16);
                    } catch(e) {}
                }

                let source = 'ParcelsApp';
                if (typeof st.carrier === 'number' && carriers[st.carrier]) {
                    source = carriers[st.carrier].name || carriers[st.carrier].title || 'ParcelsApp';
                }

                return {
                    date: dateStr || 'Recent',
                    location: st.location || 'International Transit',
                    status: st.status || 'In Transit',
                    details: st.status || 'Transit Update',
                    source: source,
                    isLocal: false
                };
            });
        } else {
            // Fallback: DOM extraction
            try {
                const pages = await browser.pages();
                const activePage = pages[pages.length - 1] || page;
                const domExtracted = await activePage.evaluate(() => {
                    const events = [];
                    const rows = document.querySelectorAll('.event, .parcel-events .event, tr.event');
                    rows.forEach(r => {
                        const text = r.innerText.trim();
                        if (!text || text.length < 5) return;
                        const lower = text.toLowerCase();
                        if (lower.includes('no information') || lower.includes('why is my parcel') || lower.includes('could not detect')) return;

                        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                        if (lines.length >= 2) {
                            let date = lines[0];
                            let status = lines[1];
                            let source = lines.length >= 3 ? lines[lines.length - 1] : 'ParcelsApp';
                            events.push({
                                date,
                                location: 'International Transit',
                                status,
                                details: status,
                                source,
                                isLocal: false
                            });
                        }
                    });
                    return events;
                });
                rawEvents = domExtracted || [];
            } catch (domErr) {
                console.log(`[ParcelsAppScraper] DOM fallback note: ${domErr.message}`);
            }
        }

        await browser.close().catch(() => {});
        browser = null;

        const cleanEvents = mergeAndDeduplicateEvents(rawEvents);
        console.log(`[ParcelsAppScraper] Successfully extracted ${cleanEvents.length} pre-BD customs events for ${cleanId}`);

        return {
            found: cleanEvents.length > 0,
            source: 'ParcelsApp',
            carrier: interceptedCarrier,
            events: cleanEvents
        };

    } catch (e) {
        console.error(`[ParcelsAppScraper] Error scraping ParcelsApp for ${cleanId}:`, e.message);
        if (browser) {
            await browser.close().catch(() => {});
        }
        return {
            found: false,
            source: 'ParcelsApp',
            error: e.message,
            events: []
        };
    }
}

module.exports = {
    fetchInternationalTracking,
    mergeAndDeduplicateEvents
};
