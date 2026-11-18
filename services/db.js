const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DB_FILE = path.join(__dirname, '..', 'data', 'parcels.json');
const CLOUD_LANG_CODE = 'la';
const CHUNK_SIZE = 240;

let cloudBotToken = null;
let syncTimer = null;
let lastRestoreAttemptTs = 0;

// Ensure data folder exists
const dataDir = path.dirname(DB_FILE);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize database file if not present
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2), 'utf-8');
}

function getActiveCloudToken() {
    return cloudBotToken || process.env.MAIL_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN_MAIL || process.env.TELEGRAM_BOT_TOKEN || null;
}

/**
 * Compress and push parcels snapshot to Telegram Bot metadata (language_code='la')
 * so the watchlist survives ephemeral container redeploys/restarts.
 */
async function pushParcelsToCloud(parcels) {
    const token = getActiveCloudToken();
    if (!token || token === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') return false;

    try {
        const list = Array.isArray(parcels) ? parcels : [];
        if (list.length === 0) {
            const res = await fetch(`https://api.telegram.org/bot${token}/deleteMyCommands`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ language_code: CLOUD_LANG_CODE })
            });
            return res.ok;
        }

        const compact = list.map(p => ({
            id: p.id,
            trackingId: p.trackingId,
            label: p.label,
            chatIds: p.chatIds || [],
            lastStatus: p.lastStatus || 'Initial registration',
            eventsCount: p.eventsCount || 0,
            currentStage: p.currentStage || 'REGISTERED',
            latestEventKey: p.latestEventKey || '',
            latestEventTimestamp: p.latestEventTimestamp || 0,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt
        }));

        const b64 = zlib.deflateRawSync(Buffer.from(JSON.stringify(compact), 'utf8')).toString('base64');
        const chunks = b64.match(new RegExp(`.{1,${CHUNK_SIZE}}`, 'g')) || [];
        if (chunks.length > 100) {
            console.warn('[ParcelDB CloudSync] Watchlist exceeds 100-chunk metadata limit; truncating oldest entries for backup.');
        }
        const commands = chunks.slice(0, 100).map((chunk, idx) => ({
            command: `db_${idx}`,
            description: chunk
        }));

        const res = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                language_code: CLOUD_LANG_CODE,
                commands
            })
        });
        const data = await res.json().catch(() => ({}));
        if (!data.ok) {
            console.error('[ParcelDB CloudSync] Backup warning:', data.description || res.status);
            return false;
        }
        return true;
    } catch (e) {
        console.error('[ParcelDB CloudSync] Backup error:', e.message);
        return false;
    }
}

function scheduleCloudSync() {
    if (!getActiveCloudToken()) return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
        syncTimer = null;
        const current = getAllParcels();
        pushParcelsToCloud(current).catch(() => {});
    }, 400);
}

/**
 * Restore parcels from Telegram Bot metadata into local parcels.json if container restarted.
 */
async function restoreParcelsFromCloud(token) {
    if (token) cloudBotToken = token;
    const activeToken = getActiveCloudToken();
    if (!activeToken || activeToken === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') return getAllParcels();

    lastRestoreAttemptTs = Date.now();
    try {
        const res = await fetch(`https://api.telegram.org/bot${activeToken}/getMyCommands?language_code=${CLOUD_LANG_CODE}`);
        const data = await res.json().catch(() => ({}));
        if (!data || !data.ok || !Array.isArray(data.result) || data.result.length === 0) {
            const local = getAllParcels();
            if (local.length > 0) {
                await pushParcelsToCloud(local);
            }
            return local;
        }

        const b64 = data.result
            .filter(c => c && /^db_\d+$/.test(c.command) && typeof c.description === 'string')
            .sort((a, b) => Number(a.command.slice(3)) - Number(b.command.slice(3)))
            .map(c => c.description)
            .join('');

        if (!b64) return getAllParcels();

        const jsonStr = zlib.inflateRawSync(Buffer.from(b64, 'base64')).toString('utf8');
        const cloudParcels = JSON.parse(jsonStr);
        if (!Array.isArray(cloudParcels) || cloudParcels.length === 0) {
            return getAllParcels();
        }

        const localParcels = getAllParcels();
        const byId = new Map();

        for (const p of cloudParcels) {
            if (p && p.trackingId) {
                byId.set(p.trackingId.trim().toUpperCase(), p);
            }
        }
        for (const lp of localParcels) {
            if (!lp || !lp.trackingId) continue;
            const key = lp.trackingId.trim().toUpperCase();
            const existing = byId.get(key);
            if (!existing) {
                byId.set(key, lp);
            } else {
                const mergedChats = Array.from(new Set([...(existing.chatIds || []), ...(lp.chatIds || [])]));
                const useLocal = (lp.eventsCount || 0) > (existing.eventsCount || 0) ||
                    (new Date(lp.updatedAt || 0).getTime() > new Date(existing.updatedAt || 0).getTime());
                byId.set(key, {
                    ...(useLocal ? { ...existing, ...lp } : { ...lp, ...existing }),
                    chatIds: mergedChats
                });
            }
        }

        const merged = Array.from(byId.values());
        fs.writeFileSync(DB_FILE, JSON.stringify(merged, null, 2), 'utf-8');
        console.log(`☁️ [ParcelDB CloudSync] Restored ${merged.length} saved parcel(s) from cloud backup.`);
        return merged;
    } catch (e) {
        console.error('[ParcelDB CloudSync] Restore error:', e.message);
        return getAllParcels();
    }
}

/**
 * Read all stored parcels
 * @returns {Array} Array of parcel objects
 */
function getAllParcels() {
    try {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        return JSON.parse(raw || '[]');
    } catch (e) {
        console.error('Database read error:', e.message);
        return [];
    }
}

/**
 * Read all stored parcels, restoring from cloud backup first if local file is empty
 * @returns {Promise<Array>}
 */
async function getAllParcelsWithCloudFallback() {
    const local = getAllParcels();
    if (local.length > 0) return local;
    if (Date.now() - lastRestoreAttemptTs < 30000) return local;
    return await restoreParcelsFromCloud();
}

/**
 * Save parcels array to file and schedule cloud backup
 * @param {Array} parcels 
 */
function saveAllParcels(parcels) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(parcels, null, 2), 'utf-8');
        scheduleCloudSync();
    } catch (e) {
        console.error('Database write error:', e.message);
    }
}

/**
 * Add or update parcel in DB
 * @param {Object} parcelData { trackingId, label, chatId }
 * @returns {Object} saved parcel
 */
function addOrUpdateParcel({ trackingId, label = '', chatId = null }) {
    const cleanId = trackingId.trim().toUpperCase();
    const parcels = getAllParcels();

    let index = parcels.findIndex(p => p.trackingId === cleanId);
    const now = new Date().toISOString();

    if (index >= 0) {
        parcels[index].label = label || parcels[index].label || cleanId;
        if (chatId) {
            if (!parcels[index].chatIds) parcels[index].chatIds = [];
            if (!parcels[index].chatIds.includes(chatId)) {
                parcels[index].chatIds.push(chatId);
            }
        }
        parcels[index].updatedAt = now;
        saveAllParcels(parcels);
        return parcels[index];
    } else {
        const newParcel = {
            id: 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            trackingId: cleanId,
            label: label || cleanId,
            chatIds: chatId ? [chatId] : [],
            lastStatus: 'Initial registration',
            eventsCount: 0,
            currentStage: 'REGISTERED',
            createdAt: now,
            updatedAt: now
        };
        parcels.push(newParcel);
        saveAllParcels(parcels);
        return newParcel;
    }
}

/**
 * Delete parcel from DB
 * @param {string} trackingId 
 * @returns {boolean} success
 */
function deleteParcel(trackingId) {
    const cleanId = trackingId.trim().toUpperCase();
    const parcels = getAllParcels();
    const initialLen = parcels.length;

    const filtered = parcels.filter(p => p.trackingId !== cleanId && p.id !== cleanId);
    if (filtered.length !== initialLen) {
        saveAllParcels(filtered);
        return true;
    }
    return false;
}

/**
 * Get single parcel by ID
 * @param {string} trackingId 
 */
function getParcel(trackingId) {
    const cleanId = trackingId.trim().toUpperCase();
    const parcels = getAllParcels();
    return parcels.find(p => p.trackingId === cleanId || p.id === cleanId);
}

/**
 * Update specific fields of an existing parcel without overwriting concurrent additions/deletions
 * @param {string} trackingId
 * @param {Object} updates
 * @returns {Object|null} updated parcel
 */
function updateParcelState(trackingId, updates) {
    const cleanId = trackingId.trim().toUpperCase();
    const parcels = getAllParcels();
    const index = parcels.findIndex(p => p.trackingId === cleanId);
    if (index < 0) return null;

    parcels[index] = {
        ...parcels[index],
        ...updates,
        updatedAt: new Date().toISOString()
    };
    saveAllParcels(parcels);
    return parcels[index];
}

module.exports = {
    getAllParcels,
    getAllParcelsWithCloudFallback,
    addOrUpdateParcel,
    deleteParcel,
    getParcel,
    saveAllParcels,
    updateParcelState,
    restoreParcelsFromCloud,
    pushParcelsToCloud
};
