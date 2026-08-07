const { fetchBDPostTracking } = require('./bdpost');
const { fetchInternationalTracking, mergeAndDeduplicateEvents } = require('./parcelsapp');
const { fetchCainiaoTracking } = require('./cainiao');

const trackingCache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes cache

/**
 * Unified Mail Tracking Engine
 * Combines Pre-BD Customs (ParcelsApp + Cainiao Global) & Post-BD Customs (BD Post IPS)
 * @param {string} trackingId 
 * @param {boolean} forceRefresh
 * @returns {Promise<Object>} Unified tracking report
 */
async function getUnifiedTracking(trackingId, forceRefresh = false) {
    const cleanId = (trackingId || '').trim().toUpperCase();
    if (!cleanId) {
        return {
            success: false,
            error: 'Invalid tracking ID provided'
        };
    }

    // Check in-memory cache
    const cached = trackingCache.get(cleanId);
    if (!forceRefresh && cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
        console.log(`[UnifiedTracker] Serving cached tracking data for ${cleanId} (Age: ${Math.round((Date.now() - cached.timestamp)/1000)}s)`);
        return cached.data;
    }

    console.log(`[UnifiedTracker] Initiating fresh tracking search for: ${cleanId}`);

    // Execute pre-BD customs (ParcelsApp + Cainiao) and post-BD customs (BD Post) in parallel
    const [intlResult, cainiaoResult, bdResultPrimary] = await Promise.all([
        fetchInternationalTracking(cleanId).catch(err => ({ found: false, error: err.message })),
        fetchCainiaoTracking(cleanId).catch(err => ({ found: false, error: err.message })),
        fetchBDPostTracking(cleanId).catch(err => ({ found: false, error: err.message }))
    ]);

    let bdResult = bdResultPrimary;

    // If international tracking found a secondary BD post tracking ID (e.g. RB...SG), query BD Post for that secondary ID too
    const secondaryId = intlResult.destinationTrackingId || cainiaoResult.destinationTrackingId;
    if (secondaryId && secondaryId !== cleanId) {
        console.log(`[UnifiedTracker] Secondary BD Tracking ID found: ${secondaryId}. Querying BD Post...`);
        const secondaryBdResult = await fetchBDPostTracking(secondaryId).catch(() => ({ found: false }));
        if (secondaryBdResult.found && secondaryBdResult.events && secondaryBdResult.events.length > 0) {
            bdResult = secondaryBdResult;
        }
    }

    const rawCombinedEvents = [];

    // 1. Add ParcelsApp events
    if (intlResult.found && intlResult.events) {
        intlResult.events.forEach(ev => {
            rawCombinedEvents.push({
                date: ev.date,
                status: ev.status,
                location: ev.location,
                details: ev.details || ev.status,
                source: ev.source || 'ParcelsApp',
                stage: 'PRE_CUSTOMS',
                badgeClass: 'badge-info',
                isLocal: false
            });
        });
    }

    // 2. Add Cainiao Global events
    if (cainiaoResult.found && cainiaoResult.events) {
        cainiaoResult.events.forEach(ev => {
            rawCombinedEvents.push({
                date: ev.date,
                status: ev.status,
                location: ev.location,
                details: ev.details || ev.status,
                source: ev.source || 'CAINIAO',
                stage: 'PRE_CUSTOMS',
                badgeClass: 'badge-info',
                isLocal: false
            });
        });
    }

    // 3. Add BD Post IPS events
    if (bdResult.found && bdResult.events) {
        bdResult.events.forEach(ev => {
            let badge = 'badge-warning';
            let stage = 'POST_CUSTOMS';
            
            const locUpper = (ev.location || '').toUpperCase();
            const statUpper = (ev.status || '').toUpperCase();
            if (locUpper.includes('CUSTOMS') || statUpper.includes('CUSTOMS')) {
                stage = 'CUSTOMS_CLEARANCE';
                badge = 'badge-customs';
            } else if (locUpper.includes('DELIVER') || statUpper.includes('DELIVER')) {
                stage = 'DELIVERED';
                badge = 'badge-success';
            }

            rawCombinedEvents.push({
                date: ev.date,
                status: `[BD Post] ${ev.status || 'In Transit'} at ${ev.location || 'Local Sorting'}`,
                location: ev.location || 'Bangladesh',
                details: ev.details || `[BD Post IPS] ${ev.status} at ${ev.location}`,
                source: 'BD Post IPS',
                stage: stage,
                badgeClass: badge,
                isLocal: true
            });
        });
    }

    // Merge and deduplicate across all 3 providers
    const allCleanEvents = mergeAndDeduplicateEvents(rawCombinedEvents);

    // Determine package stage & status text
    let currentStage = 'SHIPPED';
    let statusText = 'Item shipped by seller. Awaiting transit checkpoints.';
    let isBDCustomsCleared = false;
    let progressPercentage = 20;

    if (bdResult.found && bdResult.events && bdResult.events.length > 0) {
        const latestBd = bdResult.events[0];
        const loc = (latestBd.location || '').toUpperCase();
        const stat = (latestBd.status || '').toUpperCase();

        if (stat.includes('DELIVERED') || loc.includes('DELIVERED')) {
            currentStage = 'DELIVERED';
            statusText = `Delivered to recipient (${latestBd.location})`;
            progressPercentage = 100;
            isBDCustomsCleared = true;
        } else if (loc.includes('AIRPORT') || loc.includes('SORTING') || loc.includes('POST OFFICE')) {
            currentStage = 'BD_POST_SORTING';
            statusText = `In BD Post Office sorting at ${latestBd.location}`;
            progressPercentage = 70;
            isBDCustomsCleared = true;
        } else if (loc.includes('CUSTOMS') || stat.includes('CUSTOMS') || stat.includes('HELD BY CUSTOMS')) {
            currentStage = 'CUSTOMS';
            statusText = `Under inspection at Bangladesh Customs (${latestBd.location})`;
            progressPercentage = 50;
        } else {
            currentStage = 'ARRIVED_BD';
            statusText = `Arrived in Bangladesh (${latestBd.location})`;
            progressPercentage = 50;
            isBDCustomsCleared = true;
        }
    } else if (cainiaoResult.found || intlResult.found) {
        currentStage = 'INTL_TRANSIT';
        progressPercentage = 35;
        const topEv = allCleanEvents.length > 0 ? allCleanEvents[0] : null;
        if (topEv) {
            statusText = `In International Transit: ${topEv.status || topEv.details}`;
        } else {
            statusText = 'In International Transit (Pre-BD Customs)';
        }
    }

    return {
        success: true,
        trackingId: cleanId,
        currentStage,
        statusText,
        progressPercentage,
        isBDCustomsCleared,
        sources: {
            international: (intlResult.found ? intlResult : (cainiaoResult.found ? cainiaoResult : { found: false, carrier: 'International Courier' })),
            bdPostIPS: {
                found: bdResult.found,
                location: bdResult.events && bdResult.events.length > 0 ? bdResult.events[0].location : 'Unknown'
            }
        },
        intlSummary: intlResult.found ? {
            carrier: intlResult.carrier,
            source: intlResult.source,
            eventsCount: intlResult.events ? intlResult.events.length : 0
        } : (cainiaoResult.found ? {
            carrier: cainiaoResult.carrier,
            source: cainiaoResult.source,
            eventsCount: cainiaoResult.events ? cainiaoResult.events.length : 0
        } : null),
        bdPostSummary: bdResult.found ? {
            source: bdResult.source,
            eventsCount: bdResult.events ? bdResult.events.length : 0,
            latestLocation: bdResult.events[0] ? bdResult.events[0].location : null
        } : null,
        eventsCount: allCleanEvents.length,
        events: allCleanEvents
    };

    if (result.success && result.eventsCount > 0) {
        trackingCache.set(cleanId, { timestamp: Date.now(), data: result });
    }

    return result;
}

module.exports = {
    getUnifiedTracking
};
