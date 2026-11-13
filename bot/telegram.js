const TelegramBot = require('node-telegram-bot-api');
const { getUnifiedTracking } = require('../services/tracker');
const { getAllParcels, addOrUpdateParcel, deleteParcel, updateParcelState } = require('../services/db');

const STALE_ALERT_MAX_AGE_DAYS = 14;
let isCheckingParcels = false;

function escapeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function buildLatestEventKey(tracking) {
    const latestEv = tracking && tracking.events && tracking.events[0];
    return latestEv ? `${latestEv.date || ''}|${latestEv.status || ''}` : '';
}

function syncParcelFromTracking(trackingId, tracking) {
    if (!tracking || !tracking.success || !tracking.eventsCount || tracking.eventsCount <= 0) {
        return null;
    }
    return updateParcelState(trackingId, {
        lastStatus: tracking.statusText,
        eventsCount: tracking.eventsCount,
        currentStage: tracking.currentStage,
        latestEventKey: buildLatestEventKey(tracking),
        latestEventTimestamp: tracking.latestEventTimestamp || 0
    });
}

function buildTrackKeyboard(trackingId) {
    const cleanId = String(trackingId || '').trim().toUpperCase();
    if (!cleanId || Buffer.byteLength(`refresh_${cleanId}`, 'utf8') > 64) {
        return undefined;
    }
    return {
        inline_keyboard: [
            [
                { text: '➕ Save to Watchlist', callback_data: `add_${cleanId}` },
                { text: '🔄 Refresh Now', callback_data: `refresh_${cleanId}` }
            ]
        ]
    };
}

function formatTrackingResponse(data) {
    if (!data) return '❌ No tracking data available.';
    let msg = `📦 <b>Tracking Report:</b> <code>${escapeHtml(data.trackingId || 'N/A')}</code>\n`;
    if (data.destinationTrackingId) {
        msg += `🔖 <b>BD Post Local Ref:</b> <code>${escapeHtml(data.destinationTrackingId)}</code>\n`;
    }
    const stageStr = (data.currentStage || 'IN_TRANSIT').replace(/_/g, ' ');
    msg += `📊 <b>Stage:</b> ${escapeHtml(stageStr)}\n`;
    msg += `💡 <b>Status:</b> ${escapeHtml(data.statusText || 'Tracking search in progress')}\n\n`;

    const intlSrc = (data.sources && data.sources.international) || {};
    const bdSrc = (data.sources && data.sources.bdPostIPS) || {};

    msg += `🌐 <b>Pre-BD Customs (ParcelsApp / Cainiao):</b> ${intlSrc.found ? '✅ Active' : '❓ Pending'}\n`;
    msg += `🇧🇩 <b>Post-BD Customs (BD Post IPS):</b> ${bdSrc.found ? '✅ Registered (' + escapeHtml(bdSrc.location || 'DHAKA AIRPORT') + ')' : '⏳ Awaiting BD Customs Clearance'}\n\n`;

    msg += `📋 <b>Latest Updates (${data.eventsCount} events):</b>\n`;
    msg += `───────────────────────\n`;

    if (data.events && data.events.length > 0) {
        const topEvents = data.events.slice(0, 5);
        topEvents.forEach((ev) => {
            const flag = (ev.source || '').includes('BD') ? '🇧🇩' : '✈️';
            msg += `${flag} <b>${escapeHtml(ev.date || 'Date N/A')}</b>\n`;
            msg += `└ <i>${escapeHtml(ev.details || ev.status)}</i>\n`;
            if (ev.location) msg += `📍 <code>${escapeHtml(ev.location)}</code>\n`;
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

    const bot = new TelegramBot(token, {
        polling: {
            params: {
                allowed_updates: JSON.stringify(['message', 'callback_query'])
            }
        }
    });
    console.log('🚀 [TelegramBot] Unified Mail Tracker Telegram Bot starting polling (messages + callbacks)...');

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

        const loadingMsg = await bot.sendMessage(chatId, `🔍 Searching both <b>ParcelsApp</b> (Pre-BD Customs) & <b>BD Post IPS</b> for <code>${escapeHtml(trackingId)}</code>...`, { parse_mode: 'HTML' });

        try {
            const data = await getUnifiedTracking(trackingId);
            const formatted = formatTrackingResponse(data);
            const replyMarkup = buildTrackKeyboard(data.trackingId || trackingId);

            const opts = {
                parse_mode: 'HTML',
                ...(replyMarkup ? { reply_markup: replyMarkup } : {})
            };

            bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
            await bot.sendMessage(chatId, formatted, opts);
        } catch (err) {
            bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
            bot.sendMessage(chatId, `❌ Error fetching tracking details for <code>${escapeHtml(trackingId)}</code>: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
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
        bot.sendMessage(chatId, `✅ Saved parcel <code>${escapeHtml(saved.trackingId)}</code> (${escapeHtml(saved.label)}) to your watch list.\n` +
            `You will receive automatic alerts whenever new tracking updates appear!`, { parse_mode: 'HTML' });
    });

    // /list
    bot.onText(/\/list/, (msg) => {
        const chatId = msg.chat.id;
        const parcels = getAllParcels().filter(p => p.chatIds && p.chatIds.some(id => String(id) === String(chatId)));

        if (parcels.length === 0) {
            return bot.sendMessage(chatId, '📭 You have no saved parcels in your watchlist.\nAdd one using <code>/add &lt;tracking_id&gt; [label]</code>', { parse_mode: 'HTML' });
        }

        let reply = `📦 <b>Your Watchlist (${parcels.length}):</b>\n\n`;
        const keyboard = [];

        parcels.forEach((p, idx) => {
            reply += `${idx + 1}. <b>${escapeHtml(p.label)}</b> (<code>${escapeHtml(p.trackingId)}</code>)\n` +
                `   Status: ${escapeHtml(p.lastStatus || 'Saved')}\n\n`;

            if (Buffer.byteLength(`refresh_${p.trackingId}`, 'utf8') <= 64) {
                keyboard.push([
                    { text: `🔍 Check ${p.label}`, callback_data: `refresh_${p.trackingId}` },
                    { text: `❌ Delete`, callback_data: `del_${p.trackingId}` }
                ]);
            }
        });

        bot.sendMessage(chatId, reply, {
            parse_mode: 'HTML',
            ...(keyboard.length > 0 ? { reply_markup: { inline_keyboard: keyboard } } : {})
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
            bot.sendMessage(chatId, `🗑 Removed <code>${escapeHtml(trackingId)}</code> from watchlist.`, { parse_mode: 'HTML' });
        } else {
            bot.sendMessage(chatId, `⚠️ Parcel <code>${escapeHtml(trackingId)}</code> not found in watchlist.`, { parse_mode: 'HTML' });
        }
    });

    // Handle Inline Button callbacks
    bot.on('callback_query', async (query) => {
        const chatId = query && query.message && query.message.chat && query.message.chat.id;
        const data = query && query.data;
        if (!chatId || !data) return;

        try {
            if (data.startsWith('add_')) {
                const trkId = data.slice(4).trim().toUpperCase();
                if (!trkId) {
                    await bot.answerCallbackQuery(query.id, { text: 'Invalid tracking ID.' }).catch(() => {});
                    return;
                }

                const saved = addOrUpdateParcel({ trackingId: trkId, chatId });
                await bot.answerCallbackQuery(query.id, { text: `Saved ${saved.trackingId} to Watchlist!` }).catch(() => {});

                // Sync cached tracking snapshot if available so /list shows real status immediately
                try {
                    const current = await getUnifiedTracking(saved.trackingId);
                    syncParcelFromTracking(saved.trackingId, current);
                } catch (_) {}

                await bot.sendMessage(chatId, `✅ <code>${escapeHtml(saved.trackingId)}</code> added to watchlist.`, { parse_mode: 'HTML' });
            } else if (data.startsWith('refresh_')) {
                const trkId = data.slice(8).trim().toUpperCase();
                await bot.answerCallbackQuery(query.id, { text: `Checking ${trkId}...` }).catch(() => {});

                try {
                    const updated = await getUnifiedTracking(trkId);
                    const text = formatTrackingResponse(updated);
                    const replyMarkup = buildTrackKeyboard(updated.trackingId || trkId);
                    await bot.sendMessage(chatId, text, {
                        parse_mode: 'HTML',
                        ...(replyMarkup ? { reply_markup: replyMarkup } : {})
                    });
                } catch (err) {
                    console.error(`[TelegramBot] Refresh error for ${trkId}:`, err.message);
                    await bot.sendMessage(chatId, `❌ Error checking status for <code>${escapeHtml(trkId)}</code>: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
                }
            } else if (data.startsWith('del_')) {
                const trkId = data.slice(4).trim().toUpperCase();
                const deleted = deleteParcel(trkId);
                await bot.answerCallbackQuery(query.id, { text: deleted ? `Deleted ${trkId}` : `${trkId} not found` }).catch(() => {});
                await bot.sendMessage(
                    chatId,
                    deleted
                        ? `🗑 Removed <code>${escapeHtml(trkId)}</code>.`
                        : `⚠️ Parcel <code>${escapeHtml(trkId)}</code> was not in watchlist.`,
                    { parse_mode: 'HTML' }
                );
            }
        } catch (err) {
            console.error('[TelegramBot] Callback query error:', err.message);
            await bot.answerCallbackQuery(query.id, { text: 'Action failed, please try again.' }).catch(() => {});
        }
    });

    return bot;
}

/**
 * Background worker to check saved parcels and notify users on status update
 */
async function checkAllParcelsAndNotify(bot) {
    if (isCheckingParcels) {
        console.log('[ScheduledTask] Check already in progress, skipping overlapping run.');
        return;
    }

    const parcels = getAllParcels();
    if (parcels.length === 0) return;

    isCheckingParcels = true;
    console.log(`[ScheduledTask] Checking ${parcels.length} saved parcels for updates...`);

    try {
        for (const p of parcels) {
            // Skip already-delivered parcels so we don't re-scrape or re-notify old history
            if (p.currentStage === 'DELIVERED' && (p.eventsCount || 0) > 0) {
                continue;
            }

            try {
                const tracking = await getUnifiedTracking(p.trackingId, true);

                // Never overwrite state or send alerts on empty/failed scrapes or event count regressions
                if (!tracking || !tracking.success || !tracking.eventsCount || tracking.eventsCount <= 0) {
                    console.log(`[ScheduledTask] No events returned for ${p.trackingId}; keeping existing state.`);
                    continue;
                }

                if (tracking.eventsCount < (p.eventsCount || 0)) {
                    console.log(`[ScheduledTask] Event count dropped for ${p.trackingId} (${tracking.eventsCount} < ${p.eventsCount}); skipping transient regression.`);
                    continue;
                }

                const latestEventKey = buildLatestEventKey(tracking);
                const hasNewEvents = tracking.eventsCount > (p.eventsCount || 0);
                const isStageChanged = tracking.currentStage !== p.currentStage;
                const isLatestEventChanged = Boolean(latestEventKey) && latestEventKey !== (p.latestEventKey || '');
                const isNewStatus = tracking.statusText !== p.lastStatus;

                if (hasNewEvents || isStageChanged || isLatestEventChanged || isNewStatus) {
                    const latestTs = tracking.latestEventTimestamp || 0;
                    const eventAgeDays = latestTs > 0 ? (Date.now() - latestTs) / (1000 * 60 * 60 * 24) : 0;
                    const isStaleHistory = eventAgeDays > STALE_ALERT_MAX_AGE_DAYS;

                    // Update only this parcel in DB so concurrent /add or callback additions aren't overwritten
                    syncParcelFromTracking(p.trackingId, tracking);

                    if (isStaleHistory) {
                        console.log(`[ScheduledTask] Synced stale history for ${p.trackingId} (${Math.round(eventAgeDays)}d old) silently without sending Telegram alert.`);
                        continue;
                    }

                    if (bot && p.chatIds && p.chatIds.length > 0) {
                        console.log(`🔔 Update detected for ${p.trackingId}! New status: ${tracking.statusText}`);

                        const alertMsg = `🔔 <b>Status Update for "${escapeHtml(p.label)}"!</b>\n` +
                            `Tracking ID: <code>${escapeHtml(p.trackingId)}</code>\n\n` +
                            formatTrackingResponse(tracking);

                        await Promise.allSettled(
                            p.chatIds.map(cid =>
                                bot.sendMessage(cid, alertMsg, { parse_mode: 'HTML' }).catch(err => {
                                    console.error(`Failed to send Telegram alert to ${cid}:`, err.message);
                                })
                            )
                        );
                    }
                }
            } catch (e) {
                console.error(`Error checking update for ${p.trackingId}:`, e.message);
            }
        }
    } finally {
        isCheckingParcels = false;
    }
}

module.exports = {
    initTelegramBot,
    checkAllParcelsAndNotify
};
