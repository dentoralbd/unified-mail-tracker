const { fetchBDPostTracking } = require('./bdpost');
const { fetchInternationalTracking, mergeAndDeduplicateEvents } = require('./parcelsapp');
const { fetchCainiaoTracking } = require('./cainiao');
const { fetchMorningGlobalTracking } = require('./morning');

const trackingCache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes cache

/**
 * Unified Mail Tracking Engine
 * Combines Pre-BD Customs (ParcelsApp + Cainiao Global + Morning Global) & Post-BD Customs (BD Post IPS)
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

    // Execute pre-BD customs (ParcelsApp + Cainiao + Morning Global) and post-BD customs (BD Post) in parallel
    const [intlResult, cainiaoResult, morningResult, bdResultPrimary] = await Promise.all([
        fetchInternationalTracking(cleanId).catch(err => ({ found: false, error: err.message })),
        fetchCainiaoTracking(cleanId).catch(err => ({ found: false, error: err.message })),
        fetchMorningGlobalTracking(cleanId).catch(err => ({ found: false, error: err.message })),
        fetchBDPostTracking(cleanId).catch(err => ({ found: false, error: err.message }))
    ]);

    let bdResult = bdResultPrimary;

    // If international tracking found a secondary BD post tracking ID (e.g. AP... / RB...SG), query BD Post for that secondary ID too
    const secondaryId = intlResult.destinationTrackingId || cainiaoResult.destinationTrackingId || morningResult.destinationTrackingId;
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

    // 3. Add Morning Global events
    if (morningResult.found && morningResult.events) {
        morningResult.events.forEach(ev => {
            rawCombinedEvents.push({
                date: ev.date,
                status: ev.status,
                location: ev.location,
                details: ev.details || ev.status,
                source: ev.source || 'Morning Global',
                stage: 'PRE_CUSTOMS',
                badgeClass: 'badge-info',
                isLocal: false
            });
        });
    }

    // 4. Add BD Post IPS events
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

    // Merge and deduplicate across all providers
    const allCleanEvents = mergeAndDeduplicateEvents(rawCombinedEvents);

    // Determine package stage & status text dynamically from latest overall merged event
    let currentStage = 'SHIPPED';
    let statusText = 'Item shipped by seller. Awaiting transit checkpoints.';
    let isBDCustomsCleared = false;
    let progressPercentage = 20;

    if (allCleanEvents.length > 0) {
        const topEv = allCleanEvents[0];
        const topStatus = (topEv.status || topEv.details || '').toUpperCase();
        const topLoc = (topEv.location || '').toUpperCase();

        if (topStatus.includes('DELIVERED') || topLoc.includes('DELIVERED')) {
            currentStage = 'DELIVERED';
            statusText = `Delivered: ${topEv.details || topEv.status}`;
            progressPercentage = 100;
            isBDCustomsCleared = true;
        } else if (topStatus.includes('OUT FOR DELIVERY') || topStatus.includes('HANDED OVER') || topLoc.includes('SORTING') || topLoc.includes('POST OFFICE') || topLoc.includes('AIRPORT')) {
            currentStage = 'BD_POST_SORTING';
            statusText = `Out for Local Delivery / Sorting: ${topEv.details || topEv.status}`;
            progressPercentage = 75;
            isBDCustomsCleared = true;
        } else if (topStatus.includes('CUSTOMS CLEARED') || topStatus.includes('CLEARANCE COMPLETE')) {
            currentStage = 'ARRIVED_BD';
            statusText = `BD Customs Cleared: ${topEv.details || topEv.status}`;
            progressPercentage = 60;
            isBDCustomsCleared = true;
        } else if (topStatus.includes('CUSTOMS') || topStatus.includes('CLEARANCE') || topLoc.includes('CUSTOMS')) {
            currentStage = 'CUSTOMS';
            statusText = `Under inspection at Customs: ${topEv.details || topEv.status}`;
            progressPercentage = 50;
        } else {
            currentStage = 'INTL_TRANSIT';
            statusText = `In International Transit: ${topEv.details || topEv.status}`;
            progressPercentage = 35;
        }
    }

    return {
        success: true,
        trackingId: cleanId,
        destinationTrackingId: secondaryId || null,
        currentStage,
        statusText,
        progressPercentage,
        isBDCustomsCleared,
        sources: {
            international: (intlResult.found ? intlResult : (cainiaoResult.found ? cainiaoResult : (morningResult.found ? morningResult : { found: false, carrier: 'International Courier' }))),
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
