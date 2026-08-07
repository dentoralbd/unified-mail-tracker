document.addEventListener('DOMContentLoaded', () => {
    const trackingForm = document.getElementById('tracking-form');
    const trackingInput = document.getElementById('tracking-id-input');
    const searchSpinner = document.getElementById('search-spinner');
    const searchBtnText = document.querySelector('.search-btn-text');

    const resultsSection = document.getElementById('results-section');
    const resTrackingId = document.getElementById('res-tracking-id');
    const resStageBadge = document.getElementById('res-stage-badge');
    const resBdRef = document.getElementById('res-bd-ref');
    const resStatusSummary = document.getElementById('res-status-summary');
    const resEventCount = document.getElementById('res-event-count');
    const timelineEvents = document.getElementById('timeline-events');

    const sourceParcelsAppStatus = document.getElementById('source-parcelsapp-status');
    const sourceBdPostStatus = document.getElementById('source-bdpost-status');
    const linkParcelsApp = document.getElementById('link-parcelsapp');

    const btnSaveParcel = document.getElementById('btn-save-parcel');
    const btnRefreshTracking = document.getElementById('btn-refresh-tracking');

    const btnOpenWatchlist = document.getElementById('btn-open-watchlist');
    const btnCloseWatchlist = document.getElementById('btn-close-watchlist');
    const watchlistModal = document.getElementById('watchlist-modal');
    const watchlistItems = document.getElementById('watchlist-items');
    const watchlistCount = document.getElementById('watchlist-count');
    const btnRefreshWatchlist = document.getElementById('btn-refresh-watchlist');

    const btnOpenTelegram = document.getElementById('btn-open-telegram');
    const btnCloseTelegram = document.getElementById('btn-close-telegram');
    const telegramModal = document.getElementById('telegram-modal');

    let currentTrackingData = null;

    // Load initial watchlist count
    fetchWatchlist();

    // Sample chip click listener
    document.querySelectorAll('.sample-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const sampleId = chip.getAttribute('data-sample');
            trackingInput.value = sampleId;
            performSearch(sampleId);
        });
    });

    // Form submit search
    trackingForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const trkId = trackingInput.value.trim();
        if (trkId) {
            performSearch(trkId);
        }
    });

    // Refresh tracking button
    btnRefreshTracking.addEventListener('click', () => {
        if (currentTrackingData && currentTrackingData.trackingId) {
            performSearch(currentTrackingData.trackingId);
        }
    });

    // Save parcel to watchlist
    btnSaveParcel.addEventListener('click', async () => {
        if (!currentTrackingData) return;

        const label = prompt('Enter a label/title for this package (e.g. Smart Watch):', currentTrackingData.trackingId);
        if (label === null) return;

        try {
            const res = await fetch('/api/parcels', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ trackingId: currentTrackingData.trackingId, label })
            });
            const data = await res.json();
            if (data.success) {
                alert(`Saved "${label}" to watchlist!`);
                fetchWatchlist();
            }
        } catch (e) {
            alert('Failed to save parcel: ' + e.message);
        }
    });

    // Watchlist modal controls
    btnOpenWatchlist.addEventListener('click', () => {
        watchlistModal.classList.remove('hidden');
        fetchWatchlist();
    });
    btnCloseWatchlist.addEventListener('click', () => watchlistModal.classList.add('hidden'));

    btnRefreshWatchlist.addEventListener('click', async () => {
        btnRefreshWatchlist.innerText = 'Refreshing...';
        await fetch('/api/refresh', { method: 'POST' });
        await fetchWatchlist();
        btnRefreshWatchlist.innerText = '🔄 Refresh All Parcels';
    });

    // Telegram modal controls
    btnOpenTelegram.addEventListener('click', () => telegramModal.classList.remove('hidden'));
    btnCloseTelegram.addEventListener('click', () => telegramModal.classList.add('hidden'));

    // Perform live API search
    async function performSearch(trackingId) {
        setSearchLoading(true);
        resultsSection.classList.add('hidden');

        try {
            const res = await fetch(`/api/track/${encodeURIComponent(trackingId)}`);
            const data = await res.json();

            if (data.success) {
                currentTrackingData = data;
                renderResults(data);
                resultsSection.classList.remove('hidden');
            } else {
                alert(data.error || 'Tracking details not found');
            }
        } catch (err) {
            alert('Error connecting to tracking service: ' + err.message);
        } finally {
            setSearchLoading(false);
        }
    }

    function setSearchLoading(isLoading) {
        if (isLoading) {
            searchSpinner.classList.remove('hidden');
            searchBtnText.classList.add('hidden');
        } else {
            searchSpinner.classList.add('hidden');
            searchBtnText.classList.remove('hidden');
        }
    }

    // Render results
    function renderResults(data) {
        resTrackingId.innerText = data.trackingId;
        resStageBadge.innerText = data.currentStage.replace(/_/g, ' ');
        resStageBadge.className = `badge ${data.statusBadge}`;

        if (data.destinationTrackingId) {
            resBdRef.innerText = `BD Local Ref: ${data.destinationTrackingId}`;
            resBdRef.classList.remove('hidden');
        } else {
            resBdRef.classList.add('hidden');
        }

        resStatusSummary.innerText = data.statusText;
        resEventCount.innerText = data.eventsCount;

        // Source indicators
        sourceParcelsAppStatus.innerText = data.sources.international.found
            ? `Active (${data.sources.international.carrier})`
            : 'Pre-customs details pending';
        
        linkParcelsApp.href = `https://parcelsapp.com/en/tracking/${data.trackingId}`;

        sourceBdPostStatus.innerText = data.sources.bdPostIPS.found
            ? `Tracked in BD IPS (${data.sources.bdPostIPS.location})`
            : 'Not yet entered BD Customs / IPS system';

        // Update stepper progress
        updateStepper(data.progressPercentage);

        // Render timeline events
        timelineEvents.innerHTML = '';
        if (data.events && data.events.length > 0) {
            data.events.forEach(ev => {
                const el = document.createElement('div');
                const isBd = ev.source.includes('BD');
                el.className = `timeline-item ${isBd ? 'bd-event' : ''}`;
                
                el.innerHTML = `
                    <div class="timeline-date">${ev.date || 'N/A'}</div>
                    <div class="timeline-status">${isBd ? '🇧🇩' : '✈️'} ${ev.details || ev.status}</div>
                    ${ev.location ? `<div class="timeline-location">📍 ${ev.location}</div>` : ''}
                    <div class="timeline-source">Source: ${ev.source}</div>
                `;
                timelineEvents.appendChild(el);
            });
        } else {
            timelineEvents.innerHTML = `<p class="empty-text">No detailed updates available yet. Try refreshing in a few minutes.</p>`;
        }
    }

    function updateStepper(percentage) {
        // Steps 1 to 5
        const steps = [
            { id: 'step-1', line: 'line-1', threshold: 10 },
            { id: 'step-2', line: 'line-2', threshold: 30 },
            { id: 'step-3', line: 'line-3', threshold: 50 },
            { id: 'step-4', line: 'line-4', threshold: 70 },
            { id: 'step-5', line: null, threshold: 95 }
        ];

        steps.forEach(s => {
            const stepEl = document.getElementById(s.id);
            const lineEl = s.line ? document.getElementById(s.line) : null;

            if (percentage >= s.threshold) {
                stepEl.classList.add('completed');
                if (lineEl) lineEl.classList.add('active');
            } else {
                stepEl.classList.remove('completed', 'active');
                if (lineEl) lineEl.classList.remove('active');
            }
        });
    }

    async function fetchWatchlist() {
        try {
            const res = await fetch('/api/parcels');
            const data = await res.json();
            if (data.success) {
                watchlistCount.innerText = data.parcels.length;
                renderWatchlist(data.parcels);
            }
        } catch (e) {
            console.error('Failed to load watchlist:', e);
        }
    }

    function renderWatchlist(parcels) {
        if (!parcels || parcels.length === 0) {
            watchlistItems.innerHTML = `<p class="empty-text">No saved parcels yet. Search a parcel ID and click "Save to Watchlist".</p>`;
            return;
        }

        watchlistItems.innerHTML = '';
        parcels.forEach(p => {
            const card = document.createElement('div');
            card.className = 'watchlist-card glass-card';
            card.style.padding = '12px 16px';
            card.style.display = 'flex';
            card.style.alignItems = 'center';
            card.style.justifySpaceBetween = 'space-between';
            card.style.gap = '12px';

            card.innerHTML = `
                <div style="flex:1">
                    <div style="font-weight:700; color:white;">${p.label}</div>
                    <div style="font-family:monospace; font-size:12px; color:var(--accent-blue);">${p.trackingId}</div>
                    <div style="font-size:12px; color:var(--text-muted);">${p.lastStatus || 'Saved'}</div>
                </div>
                <div style="display:flex; gap:8px;">
                    <button class="btn btn-sm btn-outline btn-check" data-id="${p.trackingId}">Check</button>
                    <button class="btn btn-sm btn-outline btn-del" data-id="${p.trackingId}" style="color:var(--accent-red)">✕</button>
                </div>
            `;

            watchlistItems.appendChild(card);
        });

        // Add event listeners for watchlist item buttons
        document.querySelectorAll('.btn-check').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                watchlistModal.classList.add('hidden');
                trackingInput.value = id;
                performSearch(id);
            });
        });

        document.querySelectorAll('.btn-del').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.getAttribute('data-id');
                if (confirm(`Remove ${id} from watchlist?`)) {
                    await fetch(`/api/parcels/${id}`, { method: 'DELETE' });
                    fetchWatchlist();
                }
            });
        });
    }
});
