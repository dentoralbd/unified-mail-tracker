const { fetchBDPostTracking } = require('./bdpost');
const { fetchInternationalTracking, mergeAndDeduplicateEvents } = require('./parcelsapp');

/**
 * Unified Mail Tracking Engine
 * Cascades Pre-BD Customs (ParcelsApp) & Post-BD Customs (BD Post IPS)
 * @param {string} trackingId 
 * @returns {Promise<Object>} Unified tracking report
 */
async function getUnifiedTracking(trackingId) {
    const cleanId = (trackingId || '').trim().toUpperCase();
    if (!cleanId) {
        return {
            success: false,
            error: 'Invalid tracking ID provided'
        };
    }

    console.log(`[UnifiedTracker] Initiating tracking search for: ${cleanId}`);

    // Execute pre-BD customs (ParcelsApp) and post-BD customs (BD Post) in parallel
    const [intlResult, bdResultPrimary] = await Promise.all([
        fetchInternationalTracking(cleanId),
        fetchBDPostTracking(cleanId)
    ]);

    let bdResult = bdResultPrimary;

    // If international tracking found a secondary BD post tracking ID (e.g. RB...SG), query BD Post for that secondary ID too
    if (intlResult.found && intlResult.destinationTrackingId && intlResult.destinationTrackingId !== cleanId) {
        console.log(`[UnifiedTracker] Secondary BD Tracking ID found: ${intlResult.destinationTrackingId}. Querying BD Post...`);
        const secondaryBdResult = await fetchBDPostTracking(intlResult.destinationTrackingId);
        if (secondaryBdResult.found && secondaryBdResult.events.length > 0) {
            bdResult = secondaryBdResult;
        }
    }

    const rawCombinedEvents = [];

    // Process International events (Pre-BD Customs)
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

    // Process BD Post IPS events (Post-BD Customs)
    if (bdResult.found && bdResult.events) {
        bdResult.events.forEach(ev => {
            let badge = 'badge-warning';
            let stage = 'POST_CUSTOMS';

            const statusLower = (ev.status || '').toLowerCase();
            const locLower = (ev.location || '').toLowerCase();

            if (statusLower.includes('deliver') || locLower.includes('delivered')) {
                badge = 'badge-success';
                stage = 'DELIVERED';
            } else if (locLower.includes('airport') || locLower.includes('customs') || statusLower.includes('incomming')) {
                badge = 'badge-primary';
                stage = 'BD_CUSTOMS';
            } else if (locLower.includes('sorting') || locLower.includes('post office')) {
                badge = 'badge-warning';
                stage = 'LOCAL_SORTING';
            }

            rawCombinedEvents.push({
                date: ev.date,
                status: ev.status,
                location: ev.location,
                details: `[BD Post] ${ev.status} at ${ev.location} (Origin: ${ev.origin || 'N/A'})`,
                source: 'BD Post IPS',
                stage: stage,
                badgeClass: badge,
                isLocal: true
            });
        });
    }

    // Apply deduplication and multi-source merging
    const allEvents = mergeAndDeduplicateEvents(rawCombinedEvents);

    // Determine current overall progress status
    let currentStage = 'UNKNOWN';
    let statusText = 'No tracking updates found yet.';
    let statusBadge = 'badge-secondary';
    let progressPercentage = 10;

    if (bdResult.found && bdResult.events.length > 0) {
        const latestBd = bdResult.events[0];
        const statusLower = (latestBd.status || '').toLowerCase();
        const locLower = (latestBd.location || '').toLowerCase();

        if (statusLower.includes('deliver') || locLower.includes('delivered')) {
            currentStage = 'DELIVERED';
            statusText = 'Package Delivered successfully!';
            statusBadge = 'badge-success';
            progressPercentage = 100;
        } else if (locLower.includes('out for delivery') || statusLower.includes('delivery')) {
            currentStage = 'OUT_FOR_DELIVERY';
            statusText = `Out for delivery at ${latestBd.location}`;
            statusBadge = 'badge-success';
            progressPercentage = 85;
        } else if (locLower.includes('sorting') || locLower.includes('post office')) {
            currentStage = 'BD_POST_SORTING';
            statusText = `In BD Post Office sorting at ${latestBd.location}`;
            statusBadge = 'badge-warning';
            progressPercentage = 70;
        } else {
            currentStage = 'ARRIVED_BD';
            statusText = `Arrived in Bangladesh (${latestBd.location})`;
            statusBadge = 'badge-primary';
            progressPercentage = 55;
        }
    } else if (intlResult.found && intlResult.events.length > 0) {
        currentStage = 'INTERNATIONAL_TRANSIT';
        const latestIntl = intlResult.events[0];
        statusText = `In International Transit: ${latestIntl.status || latestIntl.details}`;
        statusBadge = 'badge-info';
        progressPercentage = 35;
    }

    return {
        success: true,
        trackingId: cleanId,
        destinationTrackingId: intlResult.destinationTrackingId || null,
        currentStage,
        statusText,
        statusBadge,
        progressPercentage,
        sources: {
            international: {
                found: intlResult.found,
                carrier: intlResult.carrier || 'N/A'
            },
            bdPostIPS: {
                found: bdResult.found,
                location: bdResult.latestEvent ? bdResult.latestEvent.location : 'Not in BD IPS yet'
            }
        },
        eventsCount: allEvents.length,
        events: allEvents
    };
}

module.exports = {
    getUnifiedTracking
};
