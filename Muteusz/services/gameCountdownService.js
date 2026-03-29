const fs = require('fs');
const path = require('path');
const { PermissionFlagsBits } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Muteusz');

const CLEANUP_CHANNEL_IDS = [
    '1486919971165442048', // countdown
    '1486500418358870074', // prima aprilis
];
const DATA_FILE = path.join(__dirname, '../data/game_countdown_state.json');

const COUNTDOWN_CHANNEL_ID = '1486919971165442048';
const PERMISSION_SOURCE_CHANNEL_ID = '1484281559216296149';
const PERMISSION_TARGET_CHANNEL_IDS = [
    '1486919971165442048',
    '1486500418358870074',
    '1486510420083740865',
];
const TOTAL_SECONDS = 24 * 3600; // 24:00:00
const UPDATE_INTERVAL_MS = 60 * 1000; // co minutę

function formatTime(seconds) {
    const s = Math.max(0, seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

class GameCountdownService {
    constructor() {
        this.client = null;
        this.timeRemaining = TOTAL_SECONDS;
        this.running = false;
        this.timerMessageId = null;
        this.everyoneMessageId = null;
        this._interval = null;
    }

    _loadState() {
        try {
            const raw = fs.readFileSync(DATA_FILE, 'utf8');
            const saved = JSON.parse(raw);
            this.timeRemaining    = saved.timeRemaining    ?? TOTAL_SECONDS;
            this.running          = saved.running          ?? false;
            this.timerMessageId   = saved.timerMessageId   ?? null;
            this.everyoneMessageId = saved.everyoneMessageId ?? null;
        } catch {
            // brak pliku = stan domyślny
        }
    }

    _saveState() {
        try {
            fs.writeFileSync(DATA_FILE, JSON.stringify({
                timeRemaining: this.timeRemaining,
                running: this.running,
                timerMessageId: this.timerMessageId,
                everyoneMessageId: this.everyoneMessageId,
            }, null, 2), 'utf8');
        } catch (err) {
            logger.error('❌ GameCountdown: błąd zapisu stanu:', err.message);
        }
    }

    initialize(client) {
        this.client = client;
        this._loadState();
        if (this.running) {
            this._startInterval();
            logger.info(`✅ GameCountdown: wznowiono odliczanie (pozostało: ${formatTime(this.timeRemaining)})`);
        } else {
            logger.info('✅ GameCountdown: zainicjalizowano');
        }
    }

    _buildTimerContent() {
        return `# <a:PepeAlarmMan:1341086085089857619> Procedura autodestrukcji rozpoczętą <a:PepeAlarmMan:1341086085089857619>\n# ⏰ ${formatTime(this.timeRemaining)}`;
    }

    async _isAdmin(guild, userId) {
        try {
            const member = await guild.members.fetch(userId);
            return member.permissions.has(PermissionFlagsBits.Administrator);
        } catch {
            return false; // użytkownik opuścił serwer — traktuj jak nie-admin
        }
    }

    async _cleanupChannel(channelId) {
        try {
            const channel = await this.client.channels.fetch(channelId);
            const guild = channel.guild;

            // Zbierz wszystkie wiadomości
            const allMessages = [];
            let lastId;
            while (true) {
                const opts = { limit: 100 };
                if (lastId) opts.before = lastId;
                const batch = await channel.messages.fetch(opts);
                if (batch.size === 0) break;
                for (const [, msg] of batch) allMessages.push(msg);
                lastId = batch.last()?.id;
                if (batch.size < 100) break;
            }

            // Podziel na wiadomości adminów i reszty
            const toDelete = [];
            for (const msg of allMessages) {
                if (msg.author.bot) continue;
                const isAdmin = await this._isAdmin(guild, msg.author.id);
                if (isAdmin) {
                    // Admin — usuń tylko reakcje
                    if (msg.reactions.cache.size > 0) {
                        await msg.reactions.removeAll().catch(() => {});
                    }
                } else {
                    toDelete.push(msg);
                }
            }

            // Bulk delete wiadomości < 14 dni, starsze pojedynczo
            const now = Date.now();
            const twoWeeks = 14 * 24 * 60 * 60 * 1000;
            const recent = toDelete.filter(m => now - m.createdTimestamp < twoWeeks);
            const old = toDelete.filter(m => now - m.createdTimestamp >= twoWeeks);

            for (let i = 0; i < recent.length; i += 100) {
                const batch = recent.slice(i, i + 100);
                if (batch.length === 1) await batch[0].delete().catch(() => {});
                else await channel.bulkDelete(batch).catch(() => {});
            }
            for (const msg of old) await msg.delete().catch(() => {});

            // Usuń wątki nie-adminów
            const activeThreads = await channel.threads.fetchActive().catch(() => ({ threads: new Map() }));
            for (const [, thread] of activeThreads.threads) {
                const isAdmin = await this._isAdmin(guild, thread.ownerId);
                if (!isAdmin) await thread.delete().catch(() => {});
            }

            logger.info(`🧹 GameCountdown: wyczyszczono kanał ${channelId} (${toDelete.length} wiadomości, wątki nie-adminów)`);
        } catch (err) {
            logger.error(`❌ GameCountdown: błąd czyszczenia kanału ${channelId}: ${err.message}`);
        }
    }

    async _snapshotAndApplyPermissions() {
        try {
            const sourceChannel = await this.client.channels.fetch(PERMISSION_SOURCE_CHANNEL_ID);
            const roleOverwrites = sourceChannel.permissionOverwrites.cache.filter(ow => ow.type === 0);

            for (const targetChannelId of PERMISSION_TARGET_CHANNEL_IDS) {
                try {
                    const targetChannel = await this.client.channels.fetch(targetChannelId);
                    for (const [, ow] of roleOverwrites) {
                        await targetChannel.permissionOverwrites.edit(ow.id, {
                            allow: ow.allow,
                            deny: ow.deny,
                        }, { type: 0, reason: 'GameCountdown: start gry' });
                    }
                    logger.info(`✅ GameCountdown: skopiowano uprawnienia ról na kanał ${targetChannelId}`);
                } catch (err) {
                    logger.error(`❌ GameCountdown: błąd kopiowania uprawnień na kanał ${targetChannelId}: ${err.message}`);
                }
            }
        } catch (err) {
            logger.error(`❌ GameCountdown: błąd odczytu uprawnień z kanału źródłowego: ${err.message}`);
        }
    }

    _buildEveryoneContent() {
        return [
            '@everyone',
            '## Serwer został przejęty przez boty, które dziś żyją własnym życiem <a:Pepe_ban:1368668861012119635>',
            '## Te inteligentne istoty zdecydowały, że będą uprzykrzać życie innym użytkownikom. <a:PepeEvil2:1280068960787632130>',
            '',
            '## Musicie zdecydować czy zostaniecie Graczami i rozwiążecie wszystkie zagadki przygotowane przez boty, tym samym ratując serwer? <:PepeSolidierVirtittiPapajlari:1401322467397472459>...',
            '',
            '## Czy po prostu zaczekacie aż serwer wszystko pogrąży się w chaosie <a:PepePoar:1280067288397250570> , a później po prostu zniknie. <a:PepeWymazanie:1278017567059087493>',
            '',
            '## Los serwera jest w Waszych rękach! <a:PepePopcorn:1259555900335718532>',
        ].join('\n');
    }

    async start() {
        if (this.running || this.timerMessageId) return; // już trwa lub jeszcze nie zakończono

        try {
            await this._snapshotAndApplyPermissions();

            for (const id of CLEANUP_CHANNEL_IDS) {
                await this._cleanupChannel(id);
            }

            const channel = await this.client.channels.fetch(COUNTDOWN_CHANNEL_ID);
            this.timeRemaining = TOTAL_SECONDS;
            this.running = true;

            const timerMsg = await channel.send({ content: this._buildTimerContent() });
            this.timerMessageId = timerMsg.id;

            const everyoneMsg = await channel.send({ content: this._buildEveryoneContent() });
            this.everyoneMessageId = everyoneMsg.id;

            this._saveState();
            this._startInterval();
            logger.info('🚀 GameCountdown: gra rozpoczęta');
        } catch (err) {
            this.running = false;
            this.timerMessageId = null;
            this.everyoneMessageId = null;
            logger.error('❌ GameCountdown: błąd przy starcie:', err.message);
        }
    }

    async stop() {
        if (!this.running) return;
        this.running = false;
        if (this._interval) { clearInterval(this._interval); this._interval = null; }
        this._saveState();
        logger.info('⏸️ GameCountdown: zatrzymano');
    }

    async resume() {
        if (this.running || !this.timerMessageId) return;
        this.running = true;
        this._saveState();
        this._startInterval();
        logger.info('▶️ GameCountdown: wznowiono');
    }

    async end() {
        this.running = false;
        if (this._interval) { clearInterval(this._interval); this._interval = null; }
        this.timeRemaining = TOTAL_SECONDS;
        this.timerMessageId = null;
        this.everyoneMessageId = null;
        this._saveState();
        logger.info('🏁 GameCountdown: zakończono i zresetowano');
    }

    _startInterval() {
        if (this._interval) clearInterval(this._interval);
        this._interval = setInterval(async () => {
            if (!this.running) return;
            this.timeRemaining = Math.max(0, this.timeRemaining - 60);
            this._saveState();
            await this._updateTimerMessage();
            if (this.timeRemaining <= 0) {
                this.running = false;
                this._saveState();
                clearInterval(this._interval);
                this._interval = null;
                logger.info('💥 GameCountdown: czas autodestrukcji minął');
            }
        }, UPDATE_INTERVAL_MS);
    }

    async _updateTimerMessage() {
        if (!this.timerMessageId) return;
        try {
            const channel = await this.client.channels.fetch(COUNTDOWN_CHANNEL_ID);
            const msg = await channel.messages.fetch(this.timerMessageId);
            await msg.edit({ content: this._buildTimerContent() });
        } catch (err) {
            logger.error('❌ GameCountdown: błąd aktualizacji timera:', err.message);
        }
    }
}

module.exports = GameCountdownService;
