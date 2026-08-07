const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'data', 'parcels.json');

// Ensure data folder exists
const dataDir = path.dirname(DB_FILE);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize database file if not present
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2), 'utf-8');
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
 * Save parcels array to file
 * @param {Array} parcels 
 */
function saveAllParcels(parcels) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(parcels, null, 2), 'utf-8');
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

module.exports = {
    getAllParcels,
    addOrUpdateParcel,
    deleteParcel,
    getParcel,
    saveAllParcels
};
