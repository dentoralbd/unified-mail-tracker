const TelegramBot = require('node-telegram-bot-api');
const { getUnifiedTracking } = require('../services/tracker');
const { getAllParcels, addOrUpdateParcel, deleteParcel, getParcel, saveAllParcels } = require('../services/db');

function formatTrackingResponse(data) {
    let msg = `📦 <b>Tracking Report:</b> <code>${data.trackingId}</code>\n`;
    if (data.destinationTrackingId) {
        msg += `🔖 <b>BD Post Local Ref:</b> <code>${data.destinationTrackingId}</code>\n`;
    }
    msg += `📊 <b>Stage:</b> ${data.currentStage.replace('_', ' ')}\n`;
    msg += `💡 <b>Status:</b> ${data.statusText}\n\n`;

    const intlSrc = (data.sources && data.sources.international) || {};
    const bdSrc = (data.sources && data.sources.bdPostIPS) || {};

    msg += `🌐 <b>Pre-BD Customs (ParcelsApp / Cainiao):</b> ${intlSrc.found ? '✅ Active' : '❓ Pending'}\n`;
    msg += `🇧🇩 <b>Post-BD Customs (BD Post IPS):</b> ${bdSrc.found ? '✅ Registered (' + (bdSrc.location || 'DHAKA AIRPORT') + ')' : '⏳ Awaiting BD Customs Clearance'}\n\n`;

    msg += `📋 <b>Latest Updates (${data.eventsCount} events):</b>\n`;
    msg += `───────────────────────\n`;

    if (data.events && data.events.length > 0) {
        const topEvents = data.events.slice(0, 5);
        topEvents.forEach((ev, idx) => {
            const flag = ev.source.includes('BD') ? '🇧🇩' : '✈️';
            msg += `${flag} <b>${ev.date || 'Date N/A'}</b>\n`;
            msg += `└ <i>${ev.details || ev.status}</i>\n`;
            if (ev.location) msg += `📍 <code>${ev.location}</code>\n`;
            msg += `\n`;
        });
    } else {
        msg += `<i>No detailed events recorded yet. Try checking again shortly.</i>\n`;
    }

    return msg;
}

function initTelegramBot(token) {
    if (!token || token === 'YOUR_TELEGRAM_BOT_TOKEN_HERE' || process.env.DISABLE_TELEGRAM_BOT === 'true') {
        console.log('⚠️ [TelegramBot] Telegram bot disabled or no token provided.');
        return null;
    }

    const bot = new TelegramBot(token, { polling: true });
    console.log('🚀 [TelegramBot] Unified Mail Tracker Telegram Bot starting polling...');

    // Handle polling errors gracefully (suppress noisy 409 Conflict logs from duplicate instances)
    bot.on('polling_error', (error) => {
        if (error && error.message && error.message.includes('409 Conflict')) {
            return;
        }
        console.error('[TelegramBot] Polling notice:', error ? (error.message || error) : 'Unknown polling error');
    });

    // Automatically configure Telegram Bot command menu buttons
    bot.setMyCommands([
        { command: 'track', description: 'Track package (e.g. /track UG251083645MV)' },
        { command: 'add', description: 'Save package for alerts (e.g. /add UG251083645MV Smartwatch)' },
        { command: 'list', description: 'View saved watchlist packages' },
        { command: 'delete', description: 'Remove package from watchlist' },
        { command: 'help', description: 'Show user guide & instructions' }
    ]).catch(err => console.error('[TelegramBot] Failed to set bot commands:', err.message));

    // /start command
    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        const welcomeText = `👋 <b>Welcome to Unified International Mail Tracker!</b>\n\n` +
            `I track your packages from AliExpress / International Sellers right up to Bangladesh Post IPS after customs clearance.\n\n` +
            `<b>Available Commands:</b>\n` +
            `• <code>/track &lt;tracking_id&gt;</code> - Track any parcel instantly\n` +
            `• <code>/add &lt;tracking_id&gt; [label]</code> - Save parcel for status change notifications\n` +
            `• <code>/list</code> - View your saved parcels\n` +
            `• <code>/delete &lt;tracking_id&gt;</code> - Stop tracking a parcel\n` +
            `• <code>/help</code> - Show this guide\n\n` +
            `<i>Example:</i> <code>/track UG251083645MV</code>`;
        
        bot.sendMessage(chatId, welcomeText, { parse_mode: 'HTML' });
    });

    // /help command
    bot.onText(/\/help/, (msg) => {
        bot.sendMessage(msg.chat.id, `<b>Commands Guide:</b>\n\n` +
            `1. <code>/track UG251083645MV</code> - Direct search\n` +
            `2. <code>/add UG251083645MV Smartwatch</code> - Save with a custom label\n` +
            `3. <code>/list</code> - List saved items\n` +
            `4. <code>/delete UG251083645MV</code> - Remove item`, { parse_mode: 'HTML' });
    });

    // /track <tracking_id>
    bot.onText(/\/track(?:\s+(.+))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        const trackingId = match[1];

        if (!trackingId) {
            return bot.sendMessage(chatId, '❌ Please specify a tracking ID.\nExample: <code>/track UG251083645MV</code>', { parse_mode: 'HTML' });
        }

        const loadingMsg = await bot.sendMessage(chatId, `🔍 Searching both <b>ParcelsApp</b> (Pre-BD Customs) & <b>BD Post IPS</b> for <code>${trackingId}</code>...`, { parse_mode: 'HTML' });

        try {
            const data = await getUnifiedTracking(trackingId);
            const formatted = formatTrackingResponse(data);

            const opts = {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '➕ Save to Watchlist', callback_data: `add_${data.trackingId}` },
                            { text: '🔄 Refresh Now', callback_data: `refresh_${data.trackingId}` }
                        ]
                    ]
                }
            };

            bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
            bot.sendMessage(chatId, formatted, opts);
        } catch (err) {
            bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
            bot.sendMessage(chatId, `❌ Error fetching tracking details for <code>${trackingId}</code>: ${err.message}`, { parse_mode: 'HTML' });
        }
    });

    // /add <tracking_id> [label]
    bot.onText(/\/add(?:\s+(\S+))?(?:\s+(.+))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        const trackingId = match[1];
        const label = match[2] || '';

        if (!trackingId) {
            return bot.sendMessage(chatId, '❌ Usage: <code>/add &lt;tracking_id&gt; [label]</code>\nExample: <code>/add UG251083645MV Smart Watch</code>', { parse_mode: 'HTML' });
        }

        const saved = addOrUpdateParcel({ trackingId, label, chatId });
        bot.sendMessage(chatId, `✅ Saved parcel <code>${saved.trackingId}</code> (${saved.label}) to your watch list.\n` +
            `You will receive automatic alerts whenever new tracking updates appear!`, { parse_mode: 'HTML' });
    });

    // /list
    bot.onText(/\/list/, (msg) => {
        const chatId = msg.chat.id;
        const parcels = getAllParcels().filter(p => p.chatIds && p.chatIds.includes(chatId));

        if (parcels.length === 0) {
            return bot.sendMessage(chatId, '📭 You have no saved parcels in your watchlist.\nAdd one using <code>/add &lt;tracking_id&gt; [label]</code>', { parse_mode: 'HTML' });
        }

        let reply = `📦 <b>Your Watchlist (${parcels.length}):</b>\n\n`;
        const keyboard = [];

        parcels.forEach((p, idx) => {
            reply += `${idx + 1}. <b>${p.label}</b> (<code>${p.trackingId}</code>)\n` +
                `   Status: ${p.lastStatus || 'Saved'}\n\n`;
            
            keyboard.push([
                { text: `🔍 Check ${p.label}`, callback_data: `refresh_${p.trackingId}` },
                { text: `❌ Delete`, callback_data: `del_${p.trackingId}` }
            ]);
        });

        bot.sendMessage(chatId, reply, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: keyboard }
        });
    });

    // /delete <tracking_id>
    bot.onText(/\/delete(?:\s+(\S+))?/, (msg, match) => {
        const chatId = msg.chat.id;
        const trackingId = match[1];

        if (!trackingId) {
            return bot.sendMessage(chatId, '❌ Usage: <code>/delete &lt;tracking_id&gt;</code>', { parse_mode: 'HTML' });
        }

        const success = deleteParcel(trackingId);
        if (success) {
            bot.sendMessage(chatId, `🗑 Removed <code>${trackingId}</code> from watchlist.`, { parse_mode: 'HTML' });
        } else {
            bot.sendMessage(chatId, `⚠️ Parcel <code>${trackingId}</code> not found in watchlist.`, { parse_mode: 'HTML' });
        }
    });

    // Handle Inline Button callbacks
    bot.on('callback_query', async (query) => {
        const chatId = query.message.chat.id;
        const data = query.data;

        if (data.startsWith('add_')) {
            const trkId = data.replace('add_', '');
            addOrUpdateParcel({ trackingId: trkId, chatId });
            bot.answerCallbackQuery(query.id, { text: `Saved ${trkId} to Watchlist!` });
            bot.sendMessage(chatId, `✅ <code>${trkId}</code> added to watchlist.`, { parse_mode: 'HTML' });
        } else if (data.startsWith('refresh_')) {
            const trkId = data.replace('refresh_', '');
            bot.answerCallbackQuery(query.id, { text: 'Refreshing tracking status...' });
            
            const updated = await getUnifiedTracking(trkId);
            const text = formatTrackingResponse(updated);
            bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
        } else if (data.startsWith('del_')) {
            const trkId = data.replace('del_', '');
            deleteParcel(trkId);
            bot.answerCallbackQuery(query.id, { text: `Deleted ${trkId}` });
            bot.sendMessage(chatId, `🗑 Removed <code>${trkId}</code>.`, { parse_mode: 'HTML' });
        }
    });

    return bot;
}

/**
 * Background worker to check saved parcels and notify users on status update
 */
async function checkAllParcelsAndNotify(bot) {
    if (!bot) return;

    const parcels = getAllParcels();
    if (parcels.length === 0) return;

    console.log(`[ScheduledTask] Checking ${parcels.length} saved parcels for updates...`);

    for (const p of parcels) {
        if (!p.chatIds || p.chatIds.length === 0) continue;

        try {
            const tracking = await getUnifiedTracking(p.trackingId);
            
            // Detect updates
            const isNewStatus = tracking.statusText !== p.lastStatus;
            const hasNewEvents = tracking.eventsCount > (p.eventsCount || 0);

            if (isNewStatus || hasNewEvents) {
                console.log(`🔔 Update detected for ${p.trackingId}! New status: ${tracking.statusText}`);
                
                // Update DB record
                p.lastStatus = tracking.statusText;
                p.eventsCount = tracking.eventsCount;
                p.currentStage = tracking.currentStage;
                p.updatedAt = new Date().toISOString();

                // Notify all subscribed chat IDs
                const alertMsg = `🔔 <b>Status Update for "${p.label}"!</b>\n` +
                    `Tracking ID: <code>${p.trackingId}</code>\n\n` +
                    formatTrackingResponse(tracking);

                for (const cid of p.chatIds) {
                    bot.sendMessage(cid, alertMsg, { parse_mode: 'HTML' }).catch(err => {
                        console.error(`Failed to send Telegram alert to ${cid}:`, err.message);
                    });
                }
            }
        } catch (e) {
            console.error(`Error checking update for ${p.trackingId}:`, e.message);
        }
    }

    saveAllParcels(parcels);
}

module.exports = {
    initTelegramBot,
    checkAllParcelsAndNotify
};
