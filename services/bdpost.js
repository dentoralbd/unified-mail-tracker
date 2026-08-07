const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

// Create HTTPS agent that ignores self-signed/expired cert issues if any
const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

/**
 * Query Bangladesh Post IPS mail tracking
 * @param {string} itemId - S10 tracking ID (e.g. UG251083645MV, RB123456789SG)
 * @returns {Promise<Object>} BD Post tracking result
 */
async function fetchBDPostTracking(itemId) {
    const cleanId = (itemId || '').trim().toUpperCase();
    if (!cleanId) {
        return { success: false, error: 'Tracking ID is required', events: [] };
    }

    let response = null;
    let attempts = 0;
    const postData = new URLSearchParams({ item_id: cleanId }).toString();

    try {
        while (attempts < 2 && !response) {
            attempts++;
            try {
                response = await axios.post('https://ipsbd.bdpost.gov.bd/app_mail_tracking/search1.php', postData, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                        'X-Requested-With': 'XMLHttpRequest',
                        'Referer': 'https://ipsbd.bdpost.gov.bd/mail-tracking.html',
                        'Accept': '*/*'
                    },
                    httpsAgent,
                    timeout: 15000
                });
            } catch (err) {
                if (attempts >= 2) throw err;
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        const htmlData = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

        // Check if item not found
        if (htmlData.includes('আইটেমটি পাওয়া যায়নি') || htmlData.includes('Item not found') || htmlData.includes('not found')) {
            return {
                found: false,
                source: 'BD Post IPS',
                message: 'Item not yet registered in Bangladesh Post IPS system.',
                events: []
            };
        }

        const $ = cheerio.load(htmlData);
        const events = [];

        // Parse table rows
        $('#tbl_result tr, table tr').each((index, element) => {
            // Skip header row
            if (index === 0 || $(element).find('th').length > 0) return;

            const cols = $(element).find('td');
            if (cols.length >= 4) {
                const eventDate = $(cols[0]).text().trim();
                const originCountry = $(cols[1]).text().trim();
                const destCountry = $(cols[2]).text().trim();
                const location = $(cols[3]).text().trim();
                const status = cols.length >= 5 ? $(cols[4]).text().trim() : '';

                if (eventDate) {
                    events.push({
                        date: eventDate,
                        origin: originCountry,
                        destination: destCountry,
                        location: location,
                        status: status || 'In Process',
                        details: `[BD Post IPS] ${status ? status + ' at ' : ''}${location}`,
                        source: 'BD Post IPS',
                        isLocal: true
                    });
                }
            }
        });

        return {
            found: events.length > 0,
            source: 'BD Post IPS',
            events: events,
            latestEvent: events.length > 0 ? events[0] : null
        };
    } catch (error) {
        console.error(`BD Post IPS fetch error for ${cleanId}:`, error.message);
        return {
            found: false,
            source: 'BD Post IPS',
            error: error.message,
            events: []
        };
    }
}

module.exports = {
    fetchBDPostTracking
};
