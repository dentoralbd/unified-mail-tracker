const axios = require('axios');

/**
 * Fetch tracking details from Morning Global (only for IDs ending with MG, e.g. BR004453737MG)
 * @param {string} trackingId 
 * @returns {Promise<Object>}
 */
async function fetchMorningGlobalTracking(trackingId) {
    const cleanId = (trackingId || '').trim().toUpperCase();
    if (!cleanId || !cleanId.endsWith('MG')) {
        return { found: false, source: 'Morning Global', events: [] };
    }

    console.log(`[MorningGlobal] Querying Morning Global API for MG package: ${cleanId}`);

    try {
        const formData = new URLSearchParams();
        formData.append('ydh_list', cleanId);

        const res = await axios.post('https://www.morninglobal.com/yundan/call/status_search.php', formData, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Referer': 'https://www.morninglobal.com/trace-track/',
                'X-Requested-With': 'XMLHttpRequest'
            },
            timeout: 12000
        });

        if (res.data && res.data.code === 0 && res.data.data && res.data.data.length > 0) {
            const item = res.data.data[0];
            const destinationTrackingId = item.gwkdydh || null;
            const rawEvents = item.list || [];

            const events = rawEvents.map(ev => {
                const tzStr = ev.time_zone ? ` (${ev.time_zone})` : '';
                return {
                    date: ev.status_date,
                    status: `${ev.status_name}${tzStr}`,
                    location: ev.time_zone ? `International Transit ${tzStr}` : 'International Transit',
                    details: `${ev.status_name}${tzStr}`,
                    source: 'Morning Global',
                    stage: 'PRE_CUSTOMS',
                    badgeClass: 'badge-info',
                    isLocal: false
                };
            }).reverse();

            console.log(`[MorningGlobal] Successfully retrieved ${events.length} events for ${cleanId}`);

            return {
                found: true,
                source: 'Morning Global',
                carrier: 'Morning Global Logistics',
                destinationTrackingId,
                events
            };
        }

        return { found: false, source: 'Morning Global', events: [] };
    } catch (err) {
        console.error(`[MorningGlobal] API Error for ${cleanId}:`, err.message);
        return { found: false, source: 'Morning Global', error: err.message, events: [] };
    }
}

module.exports = {
    fetchMorningGlobalTracking
};
