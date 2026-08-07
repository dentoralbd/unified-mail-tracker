require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');

const { getUnifiedTracking } = require('./services/tracker');
const { getAllParcels, addOrUpdateParcel, deleteParcel } = require('./services/db');
const { initTelegramBot, checkAllParcelsAndNotify } = require('./bot/telegram');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Telegram Bot if TELEGRAM_BOT_TOKEN is present
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const telegramBot = initTelegramBot(botToken);

// Schedule background updates every hour (0 * * * *)
cron.schedule('0 * * * *', async () => {
    console.log('[Scheduler] Running hourly automated parcel update check...');
    await checkAllParcelsAndNotify(telegramBot);
});

// Health check endpoint for Cloud / Railway monitoring
app.get('/health', (req, res) => res.status(200).send('OK'));

// REST API Endpoints

// 1. Live unified tracking lookup
app.get('/api/track/:id', async (req, res) => {
    try {
        const trackingId = req.params.id;
        const result = await getUnifiedTracking(trackingId);
        res.json(result);
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message || 'Failed to fetch tracking details'
        });
    }
});

// 2. Get saved parcels list
app.get('/api/parcels', (req, res) => {
    try {
        const parcels = getAllParcels();
        res.json({ success: true, parcels });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. Save / Add parcel
app.post('/api/parcels', (req, res) => {
    try {
        const { trackingId, label } = req.body;
        if (!trackingId) {
            return res.status(400).json({ success: false, error: 'Tracking ID is required' });
        }
        const saved = addOrUpdateParcel({ trackingId, label });
        res.json({ success: true, parcel: saved });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. Delete saved parcel
app.delete('/api/parcels/:id', (req, res) => {
    try {
        const success = deleteParcel(req.params.id);
        res.json({ success });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 5. Trigger manual refresh check
app.post('/api/refresh', async (req, res) => {
    try {
        await checkAllParcelsAndNotify(telegramBot);
        res.json({ success: true, message: 'All parcels updated successfully.' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// SPA Fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 Unified Mail Tracker Server running on port ${PORT}`);
    console.log(`🌐 Web Dashboard: http://localhost:${PORT}`);
    console.log(`======================================================\n`);
});
