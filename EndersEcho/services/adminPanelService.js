const fs = require('fs').promises;
const path = require('path');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('EndersEcho');

function fmtCost(usd) {
    if (usd === 0) return '$0.0000';
    if (usd < 0.0001) return `<$0.0001`;
    return `$${usd.toFixed(4)}`;
}

function fmtTokens(n) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
}

function fmtUptime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${totalSec % 60}s`;
}

function fmtTs(isoStr) {
    if (!isoStr) return '—';
    try {
        return new Date(isoStr).toLocaleString('pl-PL', {
            timeZone: 'Europe/Warsaw',
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    } catch { return isoStr.slice(0, 16).replace('T', ' '); }
}

function todayKey() {
    return new Date().toISOString().slice(0, 10);
}

// Limit Discord: 1024 znaki na wartość pola embeda, 4096 na opis.
// Przycina z wielokropkiem — zabezpieczenie przed crashem przy długich nickach/nazwach.
function capField(value, max = 1024) {
    const str = String(value ?? '—');
    if (str.length <= max) return str || '—';
    return str.slice(0, max - 2) + '…';
}

const MONTH_NAMES_PL = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru'];

// Klucze sekcji — kolejność = kolejność wiadomości na kanale
const SECTION_KEYS = ['system', 'users', 'servers', 'bosses', 'stats', 'costs', 'tools'];

/**
 * Centrum Dowodzenia Head Admina.
 * Panel składa się z 7 osobnych wiadomości na kanale ENDERSECHO_ADMIN_PANEL_CHANNEL_ID.
 * Każda wiadomość zawiera jeden embed + dedykowane przyciski akcji bezpośrednio pod nim.
 * Wszystkie wiadomości są edytowane automatycznie po każdym zdarzeniu.
 */
class AdminPanelService {
    constructor(dataDir, config, services) {
        this._dataFile = path.join(dataDir, 'admin_panel.json');
        this._config = config;
        this._services = services;
        // Słownik messageId per sekcja: { system, users, servers, bosses, stats, costs, tools }
        this._messageIds = {};
        this._channelId = config.adminPanelChannelId || null;
        this._client = null;
        this._startTime = Date.now();
        this._lastRecords = [];          // ostatnie rekordy (max 5, persystowane)
        this._auditLog = [];             // dziennik akcji admina (max 10, persystowany)
        this._costAlert = { threshold: null, lastAlertDate: null }; // alert kosztowy
        this._globalOcrBlocked = false;  // globalny kill-switch OCR (tryb serwisowy)
        this._lastTodayCost = 0;
        this._serversPage = 0;           // strona listy serwerów (25/stronę, RAM)
        this._refreshing = false;
        this._pendingRefresh = false;
        this._lastServerData = null;
    }

    // Zmiana strony listy serwerów (paginacja embeda Serwery); clamp wykonywany przy budowie
    changeServersPage(delta) {
        this._serversPage = Math.max(0, (this._serversPage || 0) + delta);
    }

    setClient(client) {
        this._client = client;
    }

    async load() {
        try {
            const raw = await fs.readFile(this._dataFile, 'utf8');
            const data = JSON.parse(raw);
            // Nowy format: messageIds (obiekt)
            if (data.messageIds && typeof data.messageIds === 'object') {
                this._messageIds = data.messageIds;
            } else if (data.messageId) {
                // Stary format: jedna wiadomość → ignorujemy, panel zostanie odtworzony
                this._messageIds = {};
            }
            if (!this._channelId && data.channelId) {
                this._channelId = data.channelId;
            }
            if (Array.isArray(data.lastRecords)) this._lastRecords = data.lastRecords.slice(0, 5);
            if (Array.isArray(data.auditLog)) this._auditLog = data.auditLog.slice(0, 10);
            if (data.costAlert && typeof data.costAlert === 'object') {
                this._costAlert = { threshold: data.costAlert.threshold ?? null, lastAlertDate: data.costAlert.lastAlertDate ?? null };
            }
            this._globalOcrBlocked = data.globalOcrBlocked === true;
        } catch {
            // Brak pliku — pierwszy start
        }
    }

    async _persist() {
        await fs.mkdir(path.dirname(this._dataFile), { recursive: true });
        await fs.writeFile(this._dataFile, JSON.stringify({
            messageIds: this._messageIds,
            channelId: this._channelId,
            lastRecords: this._lastRecords,
            auditLog: this._auditLog,
            costAlert: this._costAlert,
            globalOcrBlocked: this._globalOcrBlocked,
        }, null, 2), 'utf8');
    }

    // Dodaje rekord do feedu ostatnich rekordów (max 5, najnowszy pierwszy)
    setLastRecord(userName, score, bossName, guildId) {
        this._lastRecords.unshift({ userName, score, bossName, guildId, timestamp: new Date().toISOString() });
        this._lastRecords = this._lastRecords.slice(0, 5);
        this._persist().catch(() => {});
    }

    // Dziennik akcji admina — max 10 wpisów, najnowszy pierwszy
    logAdminAction(adminName, action) {
        this._auditLog.unshift({ adminName, action, timestamp: new Date().toISOString() });
        this._auditLog = this._auditLog.slice(0, 10);
        this._persist().catch(() => {});
    }

    // ── Globalny kill-switch OCR (tryb serwisowy) ────────────────────────────
    isGlobalOcrBlocked() {
        return this._globalOcrBlocked;
    }

    async setGlobalOcrBlocked(blocked) {
        this._globalOcrBlocked = blocked === true;
        await this._persist().catch(() => {});
    }

    // ── Alert kosztowy ───────────────────────────────────────────────────────
    getCostAlertThreshold() {
        return this._costAlert?.threshold ?? null;
    }

    async setCostAlertThreshold(threshold) {
        this._costAlert = { threshold: (threshold && threshold > 0) ? threshold : null, lastAlertDate: this._costAlert?.lastAlertDate ?? null };
        await this._persist().catch(() => {});
    }

    isConfigured() {
        return Boolean(this._channelId);
    }

    getChannelId() {
        return this._channelId;
    }

    // Zwraca ID pierwszej wiadomości panelu (dla backward compat z interactionHandlers)
    getMessageId() {
        return this._messageIds.system || null;
    }

    async setupChannel(channelId) {
        this._channelId = channelId;
        this._messageIds = {};
        await this._persist();
        await this._doRefresh();
    }

    // Debounced refresh
    refresh() {
        if (this._refreshing) {
            this._pendingRefresh = true;
            return;
        }
        this._refreshing = true;
        this._doRefresh()
            .catch(err => logger.error(`Panel Centrum Dowodzenia — błąd refresh: ${err.message}`))
            .finally(() => {
                this._refreshing = false;
                if (this._pendingRefresh) {
                    this._pendingRefresh = false;
                    this.refresh();
                }
            });
    }

    async _doRefresh() {
        if (!this._client || !this._channelId) return;

        const sections = await this._buildSections();

        const channel = await this._client.channels.fetch(this._channelId).catch(() => null);
        if (!channel) {
            logger.warn(`Panel Centrum Dowodzenia: kanał ${this._channelId} niedostępny`);
            return;
        }

        // Sprawdź czy wszystkie wiadomości sekcji istnieją
        const allKeysPresent = SECTION_KEYS.every(k => this._messageIds[k]);
        let allExist = false;

        if (allKeysPresent) {
            const checks = await Promise.allSettled(
                SECTION_KEYS.map(k => channel.messages.fetch(this._messageIds[k]))
            );
            allExist = checks.every(r => r.status === 'fulfilled');
        }

        if (allExist) {
            // Edytuj wszystkie sekcje równolegle
            await Promise.allSettled(
                SECTION_KEYS.map((key, i) =>
                    channel.messages.fetch(this._messageIds[key])
                        .then(msg => msg.edit({
                            embeds: [sections[i].embed],
                            components: sections[i].components,
                        }))
                )
            );
            await this._maybeCostAlert(channel);
            return;
        }

        // Usuń WSZYSTKIE stare wiadomości panelu (także sekcje ze starych układów, np. 'ocr'/'activity')
        for (const msgId of Object.values(this._messageIds)) {
            if (msgId) {
                await channel.messages.fetch(msgId)
                    .then(msg => msg.delete())
                    .catch(() => {});
            }
        }
        this._messageIds = {};

        // Wyślij nowe wiadomości sekwencyjnie (zachowuje kolejność na kanale)
        for (let i = 0; i < SECTION_KEYS.length; i++) {
            const newMsg = await channel.send({
                embeds: [sections[i].embed],
                components: sections[i].components,
            });
            this._messageIds[SECTION_KEYS[i]] = newMsg.id;
        }

        await this._persist();
        logger.info(`Panel Centrum Dowodzenia: utworzono ${SECTION_KEYS.length} wiadomości panelu na kanale ${this._channelId}`);
        await this._maybeCostAlert(channel);
    }

    // Wysyła ping alertu kosztowego, gdy dzisiejszy koszt przekroczył próg (raz dziennie)
    async _maybeCostAlert(channel) {
        try {
            const th = this._costAlert?.threshold;
            if (!th || th <= 0) return;
            const cost = this._lastTodayCost ?? 0;
            const today = todayKey();
            if (cost >= th && this._costAlert.lastAlertDate !== today) {
                this._costAlert.lastAlertDate = today;
                await this._persist().catch(() => {});
                const pings = (this._config.blockOcrUserIds || []).map(id => `<@${id}>`).join(' ');
                await channel.send({
                    content: `🔔 ${pings} **Alert kosztowy:** dzisiejszy koszt AI **${fmtCost(cost)}** przekroczył próg **$${th}**.`,
                }).catch(() => {});
                logger.warn(`Alert kosztowy: dzisiejszy koszt ${fmtCost(cost)} >= próg $${th}`);
            }
        } catch { /* alert nie może blokować refresha */ }
    }

    _getActiveGuildIds() {
        if (this._services.guildConfigService) {
            return new Set(this._services.guildConfigService.getAllConfiguredGuildIds());
        }
        return new Set((this._config.guilds || []).map(g => g.id));
    }

    // Buduje tablicę obiektów { embed, components } — po jednym na sekcję (kolejność = SECTION_KEYS)
    async _buildSections() {
        const guildIds = this._getActiveGuildIds();
        const now = new Date();

        const [globalRanking, blockedUsersArr, serverData] = await Promise.all([
            this._services.rankingService?.getGlobalRanking(guildIds).catch(() => []) ?? Promise.resolve([]),
            this._services.userBlockService?.getBlockedUsers().catch(() => []) ?? Promise.resolve([]),
            this._getServerStats([...guildIds]),
        ]);

        const ocrStats = this._services.ocrStatsService?.getStats() || null;
        const activeCooldownCount = this._getActiveCooldownCount();
        const pendingCvCount = this._getPendingCvCount();
        const todayTokens = this._getTodayTokens([...guildIds]);

        let playerActivityStats = null;
        try {
            const scoreHistorySvc = this._services.scoreHistoryService;
            if (scoreHistorySvc?.getActivePlayersStats) {
                playerActivityStats = await scoreHistorySvc.getActivePlayersStats([...guildIds]);
            }
        } catch { /* opcjonalne */ }

        const lastUpdated = now.toLocaleString('pl-PL', {
            timeZone: 'Europe/Warsaw',
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });

        // Dane sekcji Bossowie (opcjonalne serwisy — embed pokazuje '—' gdy brak)
        const bossData = await this._getBossData([...guildIds]);

        // Globalne użycia komend (pole w embedzie Statystyki)
        const cmdUsage = await this._services.commandUsageService?.getGlobalStats?.().catch(() => []) ?? [];

        // Testerzy z nickami (pole w embedzie Narzędzia)
        const testersDetailed = await this._resolveTestersDetailed();

        // Zapamiętaj dzisiejszy koszt do alertu kosztowego
        this._lastTodayCost = todayTokens.cost;

        // Kolejność MUSI odpowiadać SECTION_KEYS: system, users, servers, bosses, stats, costs, tools
        return [
            {
                embed: this._buildSystemEmbed(serverData.configured, lastUpdated, [...guildIds]),
                components: [this._buildSystemRow()],
            },
            {
                embed: this._buildUsersEmbed(globalRanking, blockedUsersArr, activeCooldownCount, pendingCvCount),
                components: [this._buildUsersRow(), this._buildUsersRow2()],
            },
            {
                embed: this._buildServersEmbed(serverData),
                components: this._buildServersComponents(serverData),
            },
            {
                embed: this._buildBossesEmbed(bossData),
                components: [this._buildBossesRow()],
            },
            {
                embed: this._buildOcrEmbed(ocrStats, [...guildIds], globalRanking, playerActivityStats, cmdUsage),
                components: [this._buildOcrRow()],
            },
            {
                embed: this._buildCostEmbed(todayTokens, [...guildIds], globalRanking),
                components: [this._buildCostRow()],
            },
            {
                embed: this._buildToolsEmbed([...guildIds], testersDetailed),
                components: [this._buildToolsRow()],
            },
        ];
    }

    // Buduje listę testerów z nickami: nick serwerowy (z serwera kanału panelu) + username Discord z linkiem
    async _resolveTestersDetailed() {
        try {
            const testers = this._services.testerService?.getTesters() ?? [];
            if (testers.length === 0) return [];
            const panelGuild = this._client?.channels?.cache?.get(this._channelId)?.guild ?? null;
            return await Promise.all(testers.map(async (te) => {
                let username = null, serverNick = null;
                try {
                    const user = this._client?.users?.cache?.get(te.userId)
                        || await this._client?.users?.fetch(te.userId).catch(() => null);
                    username = user?.username || null;
                } catch { /* opcjonalne */ }
                try {
                    const member = panelGuild?.members?.cache?.get(te.userId)
                        || await panelGuild?.members?.fetch(te.userId).catch(() => null);
                    serverNick = member?.displayName || null;
                } catch { /* opcjonalne */ }
                return { userId: te.userId, username, serverNick };
            }));
        } catch {
            return [];
        }
    }

    // Zbiera dane sekcji Bossowie: znane bossy, z rekordami, nieznane nazwy, bez zdjęcia, boss okresu
    async _getBossData(guildIds) {
        try {
            const bossAlias = this._services.bossAliasService;
            const bossRecords = this._services.bossRecordService;
            if (!bossAlias || !bossRecords) return null;

            const known = bossAlias.getExtraEnglishNames() || [];
            const [withRecords, unknownNames] = await Promise.all([
                bossRecords.getBossesWithRecords(guildIds, known).catch(() => []),
                bossRecords.getUnknownBossNames(guildIds, known).catch(() => []),
            ]);
            const images = bossAlias.getData()?.images || {};
            const noImage = known.filter(n => !images[n]);

            let periodBoss = null;
            try {
                periodBoss = await this._services.globalTop10Service?._getMostFrequentBoss?.(10) ?? null;
            } catch { /* opcjonalne */ }

            return { knownCount: known.length, withRecords, unknownNames, noImage, periodBoss };
        } catch {
            return null;
        }
    }

    _getActiveCooldownCount() {
        const svc = this._services.updateCooldownService;
        if (!svc?._cooldowns) return 0;
        const now = Date.now();
        let count = 0;
        for (const [, entry] of svc._cooldowns) {
            if (entry.expiresAt > now) count++;
        }
        return count;
    }

    _getPendingCvCount() {
        const svc = this._services.communityVerificationService;
        if (!svc?._sessions) return 0;
        return Object.values(svc._sessions).filter(s => s.status === 'pending').length;
    }

    _getTodayTokens(guildIds) {
        const svc = this._services.tokenUsageService;
        if (!svc?.data?.guilds) return { promptTokens: 0, outputTokens: 0, requests: 0, cost: 0 };
        const today = todayKey();
        let promptTokens = 0, outputTokens = 0, requests = 0;
        for (const guildId of guildIds) {
            const d = svc.data.guilds[guildId]?.[today];
            if (!d) continue;
            promptTokens += d.promptTokens || 0;
            outputTokens += d.outputTokens || 0;
            requests += d.requests || 0;
        }
        const cost = (promptTokens / 1_000_000) * 0.10 + (outputTokens / 1_000_000) * 0.40;
        return { promptTokens, outputTokens, requests, cost };
    }

    async _getServerStats(configuredGuildIds) {
        const cfgSvc = this._services.guildConfigService;
        const botGuildIds = this._client?.guilds?.cache ? new Set(this._client.guilds.cache.keys()) : new Set();
        const adminGuildId = this._config.adminGuildId || null;

        const configured = [];
        const absent = [];

        for (const guildId of configuredGuildIds) {
            const cfg = cfgSvc?.getConfig(guildId);
            if (!cfg?.configured) continue;
            let playerCount = 0;
            try {
                const ranking = await this._services.rankingService?.loadRanking(guildId).catch(() => ({})) ?? {};
                playerCount = Object.keys(ranking).length;
            } catch { /* pomiń */ }
            const ocrBlocked = cfg.ocrBlocked || [];
            const entry = {
                guildId,
                guildName: cfg.guildName || guildId,
                playerCount,
                updateBlocked: ocrBlocked.includes('update'),
                testBlocked: ocrBlocked.includes('test'),
                lang: cfg.lang || 'pol',
                tag: cfg.tag || null,
            };
            if (botGuildIds.has(guildId)) {
                configured.push(entry);
            } else {
                absent.push(entry);
            }
        }

        const unconfigured = [];
        for (const [guildId, guild] of (this._client?.guilds?.cache || new Map())) {
            if (adminGuildId && guildId === adminGuildId) continue;
            const cfg = cfgSvc?.getConfig(guildId);
            if (cfg?.configured) continue;
            unconfigured.push({ guildId, guildName: guild.name });
        }

        const result = { configured, unconfigured, absent };
        this._lastServerData = result;
        return result;
    }

    _buildProgressBar(value, max, length = 10) {
        if (!max || max <= 0) return '░'.repeat(length);
        const filled = Math.min(length, Math.round((value / max) * length));
        return '█'.repeat(filled) + '░'.repeat(length - filled);
    }

    // ─── EMBED 1: Przegląd Systemu ───────────────────────────────────────────
    _buildSystemEmbed(configuredServers, lastUpdated, guildIds) {
        const uptime = fmtUptime(Date.now() - this._startTime);
        const configuredCount = configuredServers.length;
        const ping = this._client?.ws?.ping ?? -1;
        const ram = Math.round(process.memoryUsage().rss / 1024 / 1024);

        const cfgSvc = this._services.guildConfigService;
        let aiOcrActive = 0;
        let aiOcrBlocked = 0;
        for (const guildId of guildIds) {
            const cfg = cfgSvc?.getConfig(guildId);
            if (!cfg?.configured) continue;
            const blocked = cfg.ocrBlocked || [];
            if (blocked.includes('update')) {
                aiOcrBlocked++;
            } else {
                aiOcrActive++;
            }
        }

        let nextTop10 = '—';
        const g10 = this._services.globalTop10Service;
        try {
            if (g10?._cfg?.nextTrigger && g10?._cfg?.enabled) {
                nextTop10 = fmtTs(g10._cfg.nextTrigger);
            }
        } catch { /* pomiń */ }

        // Feed ostatnich rekordów (max 5)
        const cfgSvc2 = this._services.guildConfigService;
        const lastRecordsValue = this._lastRecords.length > 0
            ? this._lastRecords.map(r => {
                const tag = cfgSvc2?.getConfig(r.guildId)?.tag || cfgSvc2?.getConfig(r.guildId)?.guildName || null;
                const tagStr = tag ? ` \`${tag}\`` : '';
                return `• **${r.userName}** — ${r.score}${r.bossName ? ` (${r.bossName})` : ''}${tagStr} · ${fmtTs(r.timestamp)}`;
            }).join('\n')
            : '—';

        // Dziennik ostatnich akcji admina (max 5 w embedzie)
        const auditValue = this._auditLog.length > 0
            ? this._auditLog.slice(0, 5).map(a => `• ${a.action} — **${a.adminName}** · ${fmtTs(a.timestamp)}`).join('\n')
            : '—';

        return new EmbedBuilder()
            .setColor(0xFF6B35)
            .setTitle('📡 Przegląd Systemu')
            .addFields(
                { name: '⏱️ Uptime', value: uptime, inline: true },
                { name: '🏓 Ping', value: ping >= 0 ? `${ping}ms` : '—', inline: true },
                { name: '💾 RAM', value: `${ram}MB`, inline: true },
                { name: '🖥️ Serwery', value: `${configuredCount}`, inline: true },
                { name: '🌐 AI OCR', value: `${aiOcrActive} aktywnych / ${aiOcrBlocked} zablokowanych`, inline: true },
                { name: '📅 Następny Global TOP10', value: nextTop10, inline: true },
                { name: '🏆 Ostatnie rekordy', value: capField(lastRecordsValue), inline: false },
                { name: '📜 Ostatnie akcje admina', value: capField(auditValue), inline: false },
            )
            .setFooter({ text: `Ostatnia aktualizacja: ${lastUpdated}` });
    }

    _buildSystemRow() {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('cc_refresh').setEmoji('🔄').setLabel('Odśwież').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('cc_top10_preview').setEmoji('📢').setLabel('Podgląd TOP10').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('panel_info').setEmoji('📢').setLabel('Wyślij Info').setStyle(ButtonStyle.Secondary),
        );
    }

    // ─── EMBED 2: Użytkownicy ─────────────────────────────────────────────────
    _buildUsersEmbed(globalRanking, blockedUsersArr, activeCooldownCount, pendingCvCount) {
        const totalPlayers = globalRanking.length;
        const blockedCount = Array.isArray(blockedUsersArr) ? blockedUsersArr.length : 0;

        // Statystyki graczy wyliczane z globalnego rankingu
        const top1 = globalRanking[0] || null;
        const leaderValue = top1 ? `**${top1.username || top1.userId}** — ${top1.score || '—'}` : '—';

        const bossCounts = new Map();
        let recordsToday = 0, records7d = 0;
        const now = Date.now();
        const dayMs = 24 * 60 * 60 * 1000;
        const todayStr = todayKey();
        for (const p of globalRanking) {
            if (p.bossName) bossCounts.set(p.bossName, (bossCounts.get(p.bossName) || 0) + 1);
            if (p.timestamp) {
                const ts = new Date(p.timestamp).getTime();
                if (!isNaN(ts)) {
                    if (new Date(p.timestamp).toISOString().slice(0, 10) === todayStr) recordsToday++;
                    if (now - ts <= 7 * dayMs) records7d++;
                }
            }
        }
        const topBoss = [...bossCounts.entries()].sort((a, b) => b[1] - a[1])[0] || null;
        const topBossValue = topBoss ? `${topBoss[0]} (**${topBoss[1]}** rekordów)` : '—';

        // Najświeższy rekord w rankingu (kiedy ustanowiono)
        let newestTs = null;
        for (const p of globalRanking) {
            if (!p.timestamp) continue;
            const ts = new Date(p.timestamp).getTime();
            if (!isNaN(ts) && (newestTs === null || ts > newestTs)) newestTs = ts;
        }
        const newestValue = newestTs !== null ? `<t:${Math.floor(newestTs / 1000)}:R>` : '—';

        let blockedValue = `${blockedCount}`;
        if (blockedCount > 0) {
            const show = blockedUsersArr.slice(0, 3);
            const lines = show.map(entry => {
                const nick = entry.username || entry.userId || '?';
                if (!entry.blockedUntil) return `• **${nick}** — permanentnie`;
                const remaining = new Date(entry.blockedUntil).getTime() - Date.now();
                if (remaining <= 0) return `• **${nick}** — wygasła`;
                const d = new Date(entry.blockedUntil);
                const day = String(d.getDate()).padStart(2, '0');
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const hh = String(d.getHours()).padStart(2, '0');
                const mm = String(d.getMinutes()).padStart(2, '0');
                return `• **${nick}** — do ${day}.${month} ${hh}:${mm}`;
            });
            if (blockedCount > 3) lines.push(`... i ${blockedCount - 3} więcej`);
            blockedValue = lines.join('\n');
        }

        return new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('👥 Użytkownicy')
            .addFields(
                { name: '👥 Łącznie graczy', value: `${totalPlayers}`, inline: true },
                { name: '⏳ Aktywne cooldowny', value: `${activeCooldownCount}`, inline: true },
                { name: '🗳️ Oczekujące CV', value: `${pendingCvCount}`, inline: true },
                { name: '👑 Lider globalny', value: capField(leaderValue, 256), inline: true },
                { name: '🎯 Najczęstszy boss rekordów', value: capField(topBossValue, 256), inline: true },
                { name: '🕐 Ostatni rekord', value: newestValue, inline: true },
                { name: '📈 Nowe rekordy', value: `Dziś: **${recordsToday}** | 7 dni: **${records7d}**`, inline: true },
                { name: '🔒 Zablokowanych', value: capField(blockedValue), inline: false },
            );
    }

    _buildUsersRow() {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('panel_block').setEmoji('🔒').setLabel('Zablokuj').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('cc_action_unblock').setEmoji('🔓').setLabel('Odblokuj').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('panel_remove').setEmoji('🗑️').setLabel('Usuń gracza').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('panel_remove_score').setEmoji('🧹').setLabel('Usuń wynik').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('panel_ach_del').setEmoji('🏆').setLabel('Usuń osiągnięcia').setStyle(ButtonStyle.Secondary),
        );
    }

    _buildUsersRow2() {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('cc_player_lookup').setEmoji('🔍').setLabel('Podgląd gracza').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('cc_clear_cooldown').setEmoji('🧊').setLabel('Wyczyść cooldown').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('cc_pending_cv').setEmoji('🗳️').setLabel('Oczekujące CV').setStyle(ButtonStyle.Secondary),
        );
    }

    // ─── EMBED 5: Statystyki (OCR & Analizy + Aktywność Graczy + Zdrowie API + Użycia komend) ─
    _buildOcrEmbed(ocrStats, guildIds = [], globalRanking = [], activityStats = null, cmdUsage = []) {
        const at = ocrStats?.allTime ?? { total: 0, success: 0, adminFixed: 0 };
        const rs = ocrStats?.resettable ?? { total: 0, success: 0, adminFixed: 0 };

        const atFixed = at.adminFixed || 0;
        const rsFixed = rs.adminFixed || 0;

        const atSuccessCount = at.total - atFixed;
        const rsSuccessCount = rs.total - rsFixed;

        const atRateNum = at.total > 0 ? (atSuccessCount / at.total) * 100 : null;
        const rsRateNum = rs.total > 0 ? (rsSuccessCount / rs.total) * 100 : null;

        const atRateStr = atRateNum !== null ? `${atRateNum.toFixed(1)}%` : '—';
        const rsRateStr = rsRateNum !== null ? `${rsRateNum.toFixed(1)}%` : '—';

        const atBar = atRateNum !== null ? this._buildProgressBar(atRateNum, 100, 10) : '░'.repeat(10);
        const rsBar = rsRateNum !== null ? this._buildProgressBar(rsRateNum, 100, 10) : '░'.repeat(10);

        const successRateValue =
            `\`[${atBar}]\` ${atRateStr} (łącznie)\n\`[${rsBar}]\` ${rsRateStr} (od resetu)`;

        const atDouble = at.doubleCheckRecovered || 0;
        const rsDouble = rs.doubleCheckRecovered || 0;
        const atDoublePct = at.total > 0 ? `${((atDouble / at.total) * 100).toFixed(1)}%` : '—';
        const rsDoublePct = rs.total > 0 ? `${((rsDouble / rs.total) * 100).toFixed(1)}%` : '—';
        const doubleCheckValue =
            `Łącznie: **${atDouble}** (${atDoublePct}) / Od resetu: **${rsDouble}** (${rsDoublePct})`;

        const currentMonth = new Date().toISOString().slice(0, 7);
        const ocrSvc = this._services.ocrStatsService;
        const cfgSvc = this._services.guildConfigService;
        const topRejected = ocrSvc?.getMonthlyTopRejectedUsers?.(currentMonth, 'all') ?? [];
        const rejUsernameMap = new Map(globalRanking.map(p => [p.userId, p.username]));
        const rejectedUsersValue = topRejected.length > 0
            ? topRejected.map((u, i) => {
                const username = rejUsernameMap.get(u.userId) || `<@${u.userId}>`;
                const link = rejUsernameMap.has(u.userId)
                    ? `[${username}](https://discord.com/users/${u.userId})`
                    : username;
                const serverTag = this._getRejectedUserPrimaryGuildTag(u.userId, currentMonth, guildIds, ocrSvc, cfgSvc);
                const tagStr = serverTag ? ` \`${serverTag}\`` : '';
                return `${i + 1}. ${link}${tagStr} — **${u.count}** odrzuc.`;
            }).join('\n')
            : '—';

        // Zdrowie API — globalne liczniki zapytań (nie podlegają resetowi)
        const api = ocrStats?.apiStats ?? { requests: 0, rejected: 0, fullFailures: 0 };
        const apiRejPct = api.requests > 0 ? `${((api.rejected / api.requests) * 100).toFixed(1)}%` : '—';
        const apiHealthValue =
            `Odrzucone przez API: **${api.rejected}** / **${api.requests}** zapytań (${apiRejPct})\n`
            + `Pełne odrzuty (screen niezaakceptowany po wszystkich retry): **${api.fullFailures}**`;

        // Aktywność graczy (dawny osobny embed — scalony)
        let activeValue = '—', newValue = '—', monthLine = '—';
        if (activityStats) {
            const { activeLastWeek, activeLastMonth, newLastWeek, newLastMonth, monthBuckets } = activityStats;
            activeValue = `Tydzień: **${activeLastWeek}** | Miesiąc: **${activeLastMonth}**`;
            newValue = `Tydzień: **${newLastWeek}** | Miesiąc: **${newLastMonth}**`;
            const now = new Date();
            const months = [];
            for (let i = 2; i >= 0; i--) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                const key = d.toISOString().slice(0, 7);
                months.push(`${MONTH_NAMES_PL[d.getMonth()]}: +${monthBuckets?.[key] || 0}`);
            }
            monthLine = months.join(' | ');
        }

        // Globalne użycia komend (dawny przycisk "Użycia komend" — scalony do embeda)
        const totalCmd = cmdUsage.reduce((sum, s) => sum + (s.count || 0), 0);
        const fmtCmd = n => n.toLocaleString('pl-PL');
        const cmdUsageValue = cmdUsage.length > 0
            ? cmdUsage.slice(0, 10).map(s => `\`/${s.name}\` — **${fmtCmd(s.count)}**`).join(' · ')
                + `\nŁącznie: **${fmtCmd(totalCmd)}**`
            : '—';

        return new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('📊 Statystyki')
            .addFields(
                { name: '📊 Analizy', value: `Łącznie: **${at.total}** / Od resetu: **${rs.total}**`, inline: false },
                { name: '✅ Success Rate', value: successRateValue, inline: false },
                { name: '🔁 Wzorzec OK za 2. razem', value: doubleCheckValue, inline: false },
                {
                    name: '❌ Odrzucone',
                    value: `Łącznie: **${at.total - (at.success || 0)}** / Od resetu: **${rs.total - (rs.success || 0)}**`,
                    inline: true,
                },
                { name: '🔧 Interwencje admina', value: `Łącznie: **${atFixed}** / Od resetu: **${rsFixed}**`, inline: true },
                { name: '🌩️ Zdrowie API (globalnie)', value: apiHealthValue, inline: false },
                { name: `🚫 Top odrzucani (${currentMonth})`, value: capField(rejectedUsersValue), inline: false },
                { name: '📈 Aktywni gracze', value: activeValue, inline: true },
                { name: '🆕 Nowi gracze', value: newValue, inline: true },
                { name: '📅 Przyrost miesięczny', value: monthLine, inline: false },
                { name: '🔢 Użycia komend (globalnie)', value: capField(cmdUsageValue), inline: false },
            );
    }

    _buildOcrRow() {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('panel_player_growth').setEmoji('📈').setLabel('Wykres przyrostu').setStyle(ButtonStyle.Secondary),
        );
    }

    // ─── EMBED 5: Koszty AI ───────────────────────────────────────────────────
    _buildCostEmbed(todayTokens, guildIds, globalRanking = []) {
        const { promptTokens, outputTokens, requests, cost } = todayTokens;

        const svc = this._services.tokenUsageService;
        const cfgSvc = this._services.guildConfigService;
        const currentMonth = new Date().toISOString().slice(0, 7);
        const dayOfMonth = new Date().getDate();
        const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();

        let monthCost = 0;
        if (svc?.data?.guilds && guildIds) {
            for (const guildId of guildIds) {
                const guildData = svc.data.guilds[guildId];
                if (!guildData) continue;
                for (const [dateKey, d] of Object.entries(guildData)) {
                    if (dateKey.startsWith(currentMonth)) {
                        monthCost += (d.promptTokens / 1_000_000) * 0.10 + (d.outputTokens / 1_000_000) * 0.40;
                    }
                }
            }
        }

        const projection = dayOfMonth > 0 ? (monthCost / dayOfMonth) * daysInMonth : 0;

        // Top 3 serwery — według nazwy, posortowane po koszcie miesięcznym
        const monthGuildCosts = [];
        if (svc?.data?.guilds && guildIds) {
            for (const guildId of guildIds) {
                const guildData = svc.data.guilds[guildId];
                if (!guildData) continue;
                let gCost = 0;
                for (const [dateKey, d] of Object.entries(guildData)) {
                    if (dateKey.startsWith(currentMonth)) {
                        gCost += (d.promptTokens / 1_000_000) * 0.10 + (d.outputTokens / 1_000_000) * 0.40;
                    }
                }
                if (gCost > 0) {
                    const cfg = cfgSvc?.getConfig(guildId);
                    monthGuildCosts.push({ name: cfg?.guildName || cfg?.tag || guildId, cost: gCost });
                }
            }
        }
        monthGuildCosts.sort((a, b) => b.cost - a.cost);
        const topGuildsValue = monthGuildCosts.slice(0, 3).length > 0
            ? monthGuildCosts.slice(0, 3).map(g => `• ${g.name}: ${fmtCost(g.cost)}`).join('\n')
            : '—';

        // Top 5 użytkowników — według ilości req, z linkiem do profilu i tagiem serwera
        const usernameMap = new Map(globalRanking.map(p => [p.userId, p.username]));
        const topUsers = (svc?.getUsersMonthlyStats?.(currentMonth, 'all') ?? []).slice(0, 5);
        const topUsersValue = topUsers.length > 0
            ? topUsers.map((u, i) => {
                const username = usernameMap.get(u.userId) || `<@${u.userId}>`;
                const link = `[${username}](https://discord.com/users/${u.userId})`;
                const serverTag = this._getUserPrimaryGuildTag(u.userId, currentMonth, guildIds, svc, cfgSvc);
                const tagStr = serverTag ? ` \`${serverTag}\`` : '';
                return `${i + 1}. ${link}${tagStr} — **${u.requests}** req.`;
            }).join('\n')
            : '—';

        // Aktualne limity + próg alertu kosztowego
        const dailyLimit = this._services.usageLimitService?.getLimit?.();
        const cooldownMs = this._services.updateCooldownService?.getCooldownDuration?.() ?? null;
        let cdStr = '—';
        if (cooldownMs && cooldownMs > 0) {
            const h = Math.floor(cooldownMs / 3600000);
            const m = Math.floor((cooldownMs % 3600000) / 60000);
            cdStr = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
        }
        const limitStr = (dailyLimit !== null && dailyLimit !== undefined) ? `${dailyLimit}/dzień` : 'brak';
        const alertTh = this.getCostAlertThreshold();
        const alertStr = alertTh ? `$${alertTh}/dzień` : 'wyłączony';

        return new EmbedBuilder()
            .setColor(0xFEE75C)
            .setTitle('💰 Koszty & Limity')
            .addFields(
                {
                    name: '📤 Dziś',
                    value: `Requesty: **${requests}** | Tokeny IN: **${fmtTokens(promptTokens)}** | OUT: **${fmtTokens(outputTokens)}** | Koszt: **${fmtCost(cost)}**`,
                    inline: false,
                },
                {
                    name: `📅 Ten miesiąc (${currentMonth})`,
                    value: `${fmtCost(monthCost)} wydane | Projekcja: ~${fmtCost(projection)}`,
                    inline: false,
                },
                {
                    name: '⚙️ Limity i alert',
                    value: `Limit dzienny: **${limitStr}** | Cooldown: **${cdStr}** | 🔔 Próg alertu: **${alertStr}**`,
                    inline: false,
                },
                { name: '🏆 Top 3 serwery (miesiąc)', value: capField(topGuildsValue), inline: false },
                { name: '👤 Top 5 użytkowników (miesiąc, req.)', value: capField(topUsersValue), inline: false },
            );
    }

    _getUserPrimaryGuildTag(userId, month, guildIds, svc, cfgSvc) {
        const usersData = svc?.data?.users || {};
        let maxReq = 0, bestTag = null;
        for (const gId of guildIds) {
            const userDays = usersData[gId]?.[userId] || {};
            let gReq = 0;
            for (const [dateKey, d] of Object.entries(userDays)) {
                if (dateKey.startsWith(month)) gReq += d.requests || 0;
            }
            if (gReq > maxReq) {
                maxReq = gReq;
                const cfg = cfgSvc?.getConfig(gId);
                bestTag = cfg?.tag || cfg?.guildName || null;
            }
        }
        return bestTag;
    }

    _getRejectedUserPrimaryGuildTag(userId, month, guildIds, ocrSvc, cfgSvc) {
        const rejData = ocrSvc?.data?.userRejections || ocrSvc?._data?.userRejections || {};
        let maxCount = 0, bestTag = null;
        for (const gId of guildIds) {
            const count = rejData[gId]?.[userId]?.[month] || 0;
            if (count > maxCount) {
                maxCount = count;
                const cfg = cfgSvc?.getConfig(gId);
                bestTag = cfg?.tag || cfg?.guildName || null;
            }
        }
        return bestTag;
    }

    _buildCostRow() {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('cc_action_tokens').setEmoji('📊').setLabel('Tokeny AI').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('panel_limit').setEmoji('⚙️').setLabel('Ustaw limity').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('cc_cost_alert').setEmoji('🔔').setLabel('Alert kosztowy').setStyle(ButtonStyle.Secondary),
        );
    }

    // ─── EMBED 6: Serwery ─────────────────────────────────────────────────────
    _buildServersEmbed({ configured, unconfigured, absent }) {
        const dailyLimit = this._services.usageLimitService?.getLimit();
        const cooldownMs = this._services.updateCooldownService?.getCooldownDuration?.() ?? null;

        let cooldownStr = '—';
        if (cooldownMs && cooldownMs > 0) {
            const h = Math.floor(cooldownMs / 3600000);
            const m = Math.floor((cooldownMs % 3600000) / 60000);
            if (h > 0 && m > 0) cooldownStr = `${h}h ${m}m`;
            else if (h > 0) cooldownStr = `${h}h`;
            else cooldownStr = `${m}m`;
        }

        const limitStr = dailyLimit !== null && dailyLimit !== undefined ? `${dailyLimit}/dzień` : '—';

        // Paginacja listy skonfigurowanych serwerów: 25 na stronę
        const PER_PAGE = 25;
        const totalPages = Math.max(1, Math.ceil(configured.length / PER_PAGE));
        if (this._serversPage >= totalPages) this._serversPage = totalPages - 1;
        if (this._serversPage < 0) this._serversPage = 0;
        const pageStart = this._serversPage * PER_PAGE;
        const pageServers = configured.slice(pageStart, pageStart + PER_PAGE);

        const lines = [];

        if (configured.length > 0) {
            lines.push(`**✅ Skonfigurowane — bot jest** (${configured.length}) | Limit: ${limitStr} | Cooldown: ${cooldownStr}`);
            for (const s of pageServers) {
                const ocrIcon = s.updateBlocked ? '❌' : '✅';
                const tag = s.tag ? ` \`${s.tag}\`` : '';
                const lang = s.lang.toUpperCase();
                lines.push(`${ocrIcon} **${s.guildName}**${tag} — ${s.playerCount} gr. | OCR: ${ocrIcon} | ${lang}`);
            }
        }

        if (unconfigured.length > 0) {
            if (lines.length > 0) lines.push('');
            lines.push('**⚠️ Nieskonfigurowane — bot jest**');
            for (const s of unconfigured.slice(0, 10)) {
                lines.push(`⚠️ **${s.guildName}** \`${s.guildId}\``);
            }
            if (unconfigured.length > 10) lines.push(`... i ${unconfigured.length - 10} więcej`);
        }

        if (absent.length > 0) {
            if (lines.length > 0) lines.push('');
            lines.push('**🔴 Skonfigurowane — brak bota**');
            for (const s of absent.slice(0, 10)) {
                const tag = s.tag ? ` \`${s.tag}\`` : '';
                const lang = s.lang.toUpperCase();
                lines.push(`🔴 **${s.guildName}**${tag} — ${s.playerCount} gr. | ${lang}`);
            }
            if (absent.length > 10) lines.push(`... i ${absent.length - 10} więcej`);
        }

        if (lines.length === 0) {
            return new EmbedBuilder()
                .setColor(0xEB459E)
                .setTitle('🖥️ Serwery')
                .setDescription('Brak skonfigurowanych serwerów.');
        }

        return new EmbedBuilder()
            .setColor(0xEB459E)
            .setTitle('🖥️ Serwery')
            .setDescription(capField(lines.join('\n'), 4096))
            .setFooter({ text: `Strona ${this._serversPage + 1}/${totalPages} • ${configured.length} serwerów` });
    }

    // Rzędy embeda Serwery: 1 = paginacja (cc_srv_pg_*), 2 = akcje, 3 = narzędzia serwerowe
    _buildServersComponents({ configured }) {
        const PER_PAGE = 25;
        const totalPages = Math.max(1, Math.ceil((configured?.length || 0) / PER_PAGE));
        const page = Math.min(Math.max(0, this._serversPage || 0), totalPages - 1);

        const paginationRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('cc_srv_pg_prev').setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
            new ButtonBuilder().setCustomId('cc_srv_pg_info').setLabel(`Strona ${page + 1}/${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
            new ButtonBuilder().setCustomId('cc_srv_pg_next').setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1),
        );

        const actionsRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('panel_ocr').setEmoji('🔄').setLabel('AI OCR').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('cc_action_roles').setEmoji('🔁').setLabel('Przetwórz role').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('panel_ban_guild').setEmoji('🚫').setLabel('Zbanuj serwer').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('panel_delete_server_data').setEmoji('🗑️').setLabel('Usuń dane').setStyle(ButtonStyle.Danger),
        );

        const toolsRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('cc_unconfigured').setEmoji('⚠️').setLabel('Nieskonfigurowane').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('cc_diag_server').setEmoji('🔍').setLabel('Diagnostyka serwera').setStyle(ButtonStyle.Secondary),
        );

        return [paginationRow, actionsRow, toolsRow];
    }

    // ─── EMBED 4: Bossowie ────────────────────────────────────────────────────
    _buildBossesEmbed(bossData) {
        if (!bossData) {
            return new EmbedBuilder()
                .setColor(0x1ABC9C)
                .setTitle('👾 Bossowie')
                .setDescription('Brak danych o bossach.');
        }

        const { knownCount, withRecords, unknownNames, noImage, periodBoss } = bossData;

        const unknownValue = unknownNames.length > 0
            ? unknownNames.slice(0, 5).map(n => `• \`${n}\``).join('\n')
                + (unknownNames.length > 5 ? `\n... i ${unknownNames.length - 5} więcej` : '')
            : '✅ Brak — wszystkie nazwy zmapowane';

        const noImageValue = noImage.length > 0
            ? noImage.slice(0, 5).map(n => `• \`${n}\``).join('\n')
                + (noImage.length > 5 ? `\n... i ${noImage.length - 5} więcej` : '')
            : '✅ Wszystkie mają zdjęcie';

        return new EmbedBuilder()
            .setColor(0x1ABC9C)
            .setTitle('👾 Bossowie')
            .addFields(
                { name: '👾 W bazie', value: `${knownCount}`, inline: true },
                { name: '🏆 Z rekordami', value: `${withRecords.length}`, inline: true },
                { name: '⚔️ Boss okresu', value: capField(periodBoss || '—', 256), inline: true },
                { name: `⚠️ Nieznane nazwy do zmapowania (${unknownNames.length})`, value: capField(unknownValue), inline: false },
                { name: `🖼️ Bez zdjęcia (${noImage.length})`, value: capField(noImageValue), inline: false },
            );
    }

    _buildBossesRow() {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('cc_action_boss_cfg').setEmoji('👾').setLabel('Konfiguracja bossów').setStyle(ButtonStyle.Primary),
        );
    }

    // ─── EMBED 7: Narzędzia ───────────────────────────────────────────────────
    _buildToolsEmbed(guildIds, testersDetailed = []) {
        const cfgSvc = this._services.guildConfigService;
        let perGuildBlocked = 0;
        for (const guildId of guildIds) {
            const cfg = cfgSvc?.getConfig(guildId);
            if (cfg?.configured && (cfg.ocrBlocked || []).includes('update')) perGuildBlocked++;
        }

        const globalState = this._globalOcrBlocked
            ? '🛑 **ZABLOKOWANY GLOBALNIE** (tryb serwisowy — /update i /test wyłączone na wszystkich serwerach)'
            : '✅ Włączony (obowiązują ustawienia per-serwer)';

        // Lista testerów: nick serwerowy + username Discord z odnośnikiem do profilu
        const testersValue = testersDetailed.length > 0
            ? testersDetailed.map(te => {
                const link = `[${te.username || te.userId}](https://discord.com/users/${te.userId})`;
                return te.serverNick
                    ? `• **${te.serverNick}** — ${link}`
                    : `• ${link}`;
            }).join('\n')
            : '—';

        let nextTop10 = '—';
        const g10 = this._services.globalTop10Service;
        try {
            if (g10?._cfg?.nextTrigger && g10?._cfg?.enabled) {
                nextTop10 = fmtTs(g10._cfg.nextTrigger);
            }
        } catch { /* pomiń */ }

        return new EmbedBuilder()
            .setColor(0x95A5A6)
            .setTitle('⚙️ Narzędzia')
            .addFields(
                { name: `🧪 Testerzy OCR (${testersDetailed.length})`, value: capField(testersValue), inline: false },
                { name: '🔄 OCR zablokowany per-serwer', value: `${perGuildBlocked}`, inline: true },
                { name: '📅 Następny Global TOP10', value: nextTop10, inline: true },
                { name: '🌐 Globalny OCR', value: globalState, inline: false },
            );
    }

    _buildToolsRow() {
        const ocrBtn = this._globalOcrBlocked
            ? new ButtonBuilder().setCustomId('cc_global_ocr').setEmoji('▶️').setLabel('Włącz OCR globalnie').setStyle(ButtonStyle.Success)
            : new ButtonBuilder().setCustomId('cc_global_ocr').setEmoji('🛑').setLabel('Wyłącz OCR globalnie').setStyle(ButtonStyle.Danger);

        return new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('cc_action_tester').setEmoji('🧪').setLabel('Testerzy').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('panel_top10_interval').setEmoji('📅').setLabel('Interwał TOP10').setStyle(ButtonStyle.Secondary),
            ocrBtn,
        );
    }
}

module.exports = AdminPanelService;
