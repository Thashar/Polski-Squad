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

function timeSince(isoStr) {
    if (!isoStr) return '—';
    const diff = Date.now() - new Date(isoStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'przed chwilą';
    if (m < 60) return `${m} min temu`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h temu`;
    return `${Math.floor(h / 24)}d temu`;
}

function todayKey() {
    return new Date().toISOString().slice(0, 10);
}

// Polska nazwa miesiąca (skrócona)
const MONTH_NAMES_PL = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru'];

/**
 * Zarządza wiadomością Centrum Dowodzenia Head Admina.
 * Panel jest wiadomością na kanale ENDERSECHO_ADMIN_PANEL_CHANNEL_ID,
 * automatycznie edytowaną po każdym nowym rekordzie lub akcji admina.
 */
class AdminPanelService {
    constructor(dataDir, config, services) {
        this._dataFile = path.join(dataDir, 'admin_panel.json');
        this._config = config;
        this._services = services;
        this._messageId = null;
        this._channelId = config.adminPanelChannelId || null;
        this._client = null;
        this._startTime = Date.now();
        // { userName, score, bossName, guildId, timestamp }
        this._lastRecord = null;
        this._refreshing = false;
        this._pendingRefresh = false;
        this._lastServerData = null;
    }

    setClient(client) {
        this._client = client;
    }

    async load() {
        try {
            const raw = await fs.readFile(this._dataFile, 'utf8');
            const data = JSON.parse(raw);
            this._messageId = data.messageId || null;
            if (!this._channelId && data.channelId) {
                this._channelId = data.channelId;
            }
        } catch {
            // Brak pliku — pierwszy start
        }
    }

    async _persist() {
        await fs.mkdir(path.dirname(this._dataFile), { recursive: true });
        await fs.writeFile(this._dataFile, JSON.stringify({
            messageId: this._messageId,
            channelId: this._channelId,
        }, null, 2), 'utf8');
    }

    setLastRecord(userName, score, bossName, guildId) {
        this._lastRecord = { userName, score, bossName, guildId, timestamp: new Date().toISOString() };
    }

    isConfigured() {
        return Boolean(this._channelId);
    }

    getChannelId() {
        return this._channelId;
    }

    getMessageId() {
        return this._messageId;
    }

    // Ustaw kanał panelu (używane przez komendę /manage → Centrum Dowodzenia → Skonfiguruj)
    async setupChannel(channelId) {
        this._channelId = channelId;
        this._messageId = null;
        await this._persist();
        await this._doRefresh();
    }

    // Debounced refresh — maksymalnie jeden pending na raz
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

        const embeds = await this._buildEmbeds(); // ustawia this._lastServerData
        const components = this._buildComponents(this._lastServerData);

        const channel = await this._client.channels.fetch(this._channelId).catch(() => null);
        if (!channel) {
            logger.warn(`Panel Centrum Dowodzenia: kanał ${this._channelId} niedostępny`);
            return;
        }

        if (this._messageId) {
            const msg = await channel.messages.fetch(this._messageId).catch(() => null);
            if (msg) {
                await msg.edit({ embeds, components });
                return;
            }
            // Wiadomość usunięta — wyczyść ID, wyślij nową
            this._messageId = null;
        }

        const newMsg = await channel.send({ embeds, components });
        this._messageId = newMsg.id;
        await this._persist();
        logger.info(`Panel Centrum Dowodzenia: nowa wiadomość ${this._messageId} na kanale ${this._channelId}`);
    }

    _getActiveGuildIds() {
        if (this._services.guildConfigService) {
            return new Set(this._services.guildConfigService.getAllConfiguredGuildIds());
        }
        return new Set((this._config.guilds || []).map(g => g.id));
    }

    async _buildEmbeds() {
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

        // Statystyki aktywności graczy
        let playerActivityStats = null;
        try {
            const scoreHistorySvc = this._services.scoreHistoryService;
            if (scoreHistorySvc?.getActivePlayersStats) {
                playerActivityStats = await scoreHistorySvc.getActivePlayersStats([...guildIds]);
            }
        } catch { /* pomiń — opcjonalne */ }

        const lastUpdated = now.toLocaleString('pl-PL', {
            timeZone: 'Europe/Warsaw',
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });

        return [
            this._buildSystemEmbed(serverData.configured, lastUpdated, [...guildIds]),
            this._buildUsersEmbed(globalRanking, blockedUsersArr, activeCooldownCount, pendingCvCount),
            this._buildOcrEmbed(ocrStats, pendingCvCount),
            this._buildActivityEmbed(playerActivityStats),
            this._buildCostEmbed(todayTokens, [...guildIds]),
            this._buildServersEmbed(serverData),
        ];
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

        // Policz AI OCR per serwer
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

        // Następny Global TOP10
        let nextTop10 = '—';
        const g10 = this._services.globalTop10Service;
        try {
            if (g10?._cfg?.nextTrigger && g10?._cfg?.enabled) {
                nextTop10 = fmtTs(g10._cfg.nextTrigger);
            }
        } catch { /* pomiń */ }

        return new EmbedBuilder()
            .setColor(0xFF6B35)
            .setTitle('📡 Przegląd Systemu')
            .addFields(
                { name: '⏱️ Uptime', value: uptime, inline: true },
                { name: '🏓 Ping (ms)', value: ping >= 0 ? `${ping}ms` : '—', inline: true },
                { name: '💾 RAM', value: `${ram}MB`, inline: true },
                { name: '🖥️ Serwery', value: `${configuredCount}`, inline: true },
                { name: '🌐 AI OCR', value: `${aiOcrActive} aktywnych / ${aiOcrBlocked} zablokowanych`, inline: true },
                { name: '📅 Następny Global TOP10', value: nextTop10, inline: true },
            )
            .setFooter({ text: `Ostatnia aktualizacja: ${lastUpdated}` });
    }

    // ─── EMBED 2: Użytkownicy ─────────────────────────────────────────────────
    _buildUsersEmbed(globalRanking, blockedUsersArr, activeCooldownCount, pendingCvCount) {
        const totalPlayers = globalRanking.length;
        const blockedCount = Array.isArray(blockedUsersArr) ? blockedUsersArr.length : 0;
        const testerCount = this._services.testerService?.getTesters()?.length ?? 0;

        // Lista zablokowanych (max 3)
        let blockedValue = `${blockedCount}`;
        if (blockedCount > 0) {
            const show = blockedUsersArr.slice(0, 3);
            const lines = show.map(entry => {
                const nick = entry.username || entry.userId || '?';
                if (!entry.blockedUntil) return `• **${nick}** — permanentnie`;
                const remaining = new Date(entry.blockedUntil).getTime() - Date.now();
                if (remaining <= 0) return `• **${nick}** — wygasła`;
                // Formatuj datę DD.MM HH:MM
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
                { name: '🧪 Testerzy', value: `${testerCount}`, inline: true },
                { name: '🔒 Zablokowanych', value: blockedValue, inline: false },
                { name: '🗳️ Oczekujące CV', value: `${pendingCvCount}`, inline: true },
            );
    }

    // ─── EMBED 3: OCR & Analizy ──────────────────────────────────────────────
    _buildOcrEmbed(ocrStats, pendingCvCount) {
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

        return new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('📊 OCR & Analizy')
            .addFields(
                {
                    name: '📊 Analizy',
                    value: `Łącznie: **${at.total}** / Od resetu: **${rs.total}**`,
                    inline: false,
                },
                { name: '✅ Success Rate', value: successRateValue, inline: false },
                {
                    name: '❌ Odrzucone',
                    value: `Łącznie: **${at.total - (at.success || 0)}** / Od resetu: **${rs.total - (rs.success || 0)}**`,
                    inline: true,
                },
                {
                    name: '🔧 Interwencje admina',
                    value: `Łącznie: **${atFixed}** / Od resetu: **${rsFixed}**`,
                    inline: true,
                },
                { name: '🗳️ Oczekujące CV', value: `${pendingCvCount}`, inline: true },
            );
    }

    // ─── EMBED 4: Aktywność Graczy ────────────────────────────────────────────
    _buildActivityEmbed(stats) {
        if (!stats) {
            return new EmbedBuilder()
                .setColor(0x9B59B6)
                .setTitle('🏆 Aktywność Graczy')
                .setDescription('Brak danych o aktywności.');
        }

        const { activeLastWeek, activeLastMonth, newLastWeek, newLastMonth, monthBuckets } = stats;

        // Ostatnie 3 miesiące
        const now = new Date();
        const months = [];
        for (let i = 2; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = d.toISOString().slice(0, 7);
            const count = monthBuckets?.[key] || 0;
            months.push({ label: MONTH_NAMES_PL[d.getMonth()], count });
        }
        const monthLine = months.map(m => `${m.label}: +${m.count}`).join(' | ');

        return new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle('🏆 Aktywność Graczy')
            .addFields(
                {
                    name: '📈 Aktywni gracze',
                    value: `Tydzień: **${activeLastWeek}** | Miesiąc: **${activeLastMonth}**`,
                    inline: false,
                },
                {
                    name: '🆕 Nowi gracze',
                    value: `Tydzień: **${newLastWeek}** | Miesiąc: **${newLastMonth}**`,
                    inline: false,
                },
                {
                    name: '📅 Przyrost miesięczny',
                    value: monthLine || '—',
                    inline: false,
                },
            );
    }

    // ─── EMBED 5: Koszty AI ───────────────────────────────────────────────────
    _buildCostEmbed(todayTokens, guildIds) {
        const { promptTokens, outputTokens, requests, cost } = todayTokens;

        // Koszt tego miesiąca
        const svc = this._services.tokenUsageService;
        const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
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

        // Top 3 serwery po koszcie dziś
        const today = todayKey();
        const guildCosts = [];
        if (svc?.data?.guilds && guildIds) {
            const cfgSvc = this._services.guildConfigService;
            for (const guildId of guildIds) {
                const d = svc.data.guilds[guildId]?.[today];
                if (!d) continue;
                const gCost = (d.promptTokens / 1_000_000) * 0.10 + (d.outputTokens / 1_000_000) * 0.40;
                if (gCost > 0) {
                    const cfg = cfgSvc?.getConfig(guildId);
                    guildCosts.push({ tag: cfg?.tag || cfg?.guildName || guildId, cost: gCost });
                }
            }
        }
        guildCosts.sort((a, b) => b.cost - a.cost);
        const topGuilds = guildCosts.slice(0, 3);
        const topGuildsValue = topGuilds.length > 0
            ? topGuilds.map(g => `• ${g.tag}: ${fmtCost(g.cost)}`).join('\n')
            : '—';

        return new EmbedBuilder()
            .setColor(0xFEE75C)
            .setTitle('💰 Koszty AI')
            .addFields(
                {
                    name: '📤 Dziś',
                    value: `Requesty: **${requests}** | Tokeny IN: **${fmtTokens(promptTokens)}** | Tokeny OUT: **${fmtTokens(outputTokens)}** | Koszt: **${fmtCost(cost)}**`,
                    inline: false,
                },
                {
                    name: '📅 Ten miesiąc',
                    value: `${fmtCost(monthCost)} wydane | Projekcja: ~${fmtCost(projection)}`,
                    inline: false,
                },
                {
                    name: '🏆 Top serwery (dziś)',
                    value: topGuildsValue,
                    inline: false,
                },
            );
    }

    // ─── EMBED 6: Serwery ─────────────────────────────────────────────────────
    _buildServersEmbed({ configured, unconfigured, absent }) {
        const dailyLimit = this._services.usageLimitService?.getLimit();
        const cooldownMs = this._services.updateCooldownService?.getCooldownDuration?.() ?? null;

        // Formatuj cooldown
        let cooldownStr = '—';
        if (cooldownMs && cooldownMs > 0) {
            const h = Math.floor(cooldownMs / 3600000);
            const m = Math.floor((cooldownMs % 3600000) / 60000);
            if (h > 0 && m > 0) cooldownStr = `${h}h ${m}m`;
            else if (h > 0) cooldownStr = `${h}h`;
            else cooldownStr = `${m}m`;
        }

        const limitStr = dailyLimit !== null && dailyLimit !== undefined ? `${dailyLimit}/dzień` : '—';

        const lines = [];

        if (configured.length > 0) {
            lines.push(`**✅ Skonfigurowane — bot jest** | Limit: ${limitStr} | Cooldown: ${cooldownStr}`);
            for (const s of configured) {
                const ocrIcon = s.updateBlocked ? '❌' : '✅';
                const tag = s.tag ? ` \`${s.tag}\`` : '';
                const lang = s.lang.toUpperCase();
                lines.push(`${ocrIcon} **${s.guildName}**${tag} — ${s.playerCount} gr. | OCR: ${ocrIcon} | ${lang}`);
            }
        }

        if (unconfigured.length > 0) {
            if (lines.length > 0) lines.push('');
            lines.push('**⚠️ Nieskonfigurowane — bot jest**');
            for (const s of unconfigured) {
                lines.push(`⚠️ **${s.guildName}** \`${s.guildId}\``);
            }
        }

        if (absent.length > 0) {
            if (lines.length > 0) lines.push('');
            lines.push('**🔴 Skonfigurowane — brak bota**');
            for (const s of absent) {
                const tag = s.tag ? ` \`${s.tag}\`` : '';
                const lang = s.lang.toUpperCase();
                lines.push(`🔴 **${s.guildName}**${tag} — ${s.playerCount} gr. | ${lang}`);
            }
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
            .setDescription(lines.join('\n'));
    }

    // ─── Komponenty panelu (4 rzędy przycisków) ────────────────────────────────
    _buildComponents(serverData) {
        const components = [];

        // Rząd 1 — System
        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('cc_refresh')
                .setEmoji('🔄')
                .setLabel('Odśwież')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('panel_top10_interval')
                .setEmoji('📅')
                .setLabel('Interwał TOP10')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('panel_info')
                .setEmoji('📢')
                .setLabel('Wyślij Info')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('panel_player_growth')
                .setEmoji('📈')
                .setLabel('Przyrost graczy')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('cc_action_cmd_usage')
                .setEmoji('🔢')
                .setLabel('Użycia komend')
                .setStyle(ButtonStyle.Secondary),
        );
        components.push(row1);

        // Rząd 2 — Użytkownicy
        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('panel_block')
                .setEmoji('🔒')
                .setLabel('Zablokuj')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('cc_action_unblock')
                .setEmoji('🔓')
                .setLabel('Odblokuj')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('panel_remove')
                .setEmoji('🗑️')
                .setLabel('Usuń gracza')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('panel_ach_del')
                .setEmoji('🏆')
                .setLabel('Usuń osiągnięcia')
                .setStyle(ButtonStyle.Secondary),
        );
        components.push(row2);

        // Rząd 3 — Serwer/OCR
        const row3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('panel_ocr')
                .setEmoji('🔄')
                .setLabel('AI OCR')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('panel_limit')
                .setEmoji('⚙️')
                .setLabel('Ustaw limity')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('cc_action_roles')
                .setEmoji('🔁')
                .setLabel('Przetwórz role')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('cc_action_tester')
                .setEmoji('🧪')
                .setLabel('Testerzy')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('panel_ban_guild')
                .setEmoji('🚫')
                .setLabel('Zbanuj serwer')
                .setStyle(ButtonStyle.Danger),
        );
        components.push(row3);

        // Rząd 4 — Statystyki
        const row4 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('cc_action_tokens')
                .setEmoji('📊')
                .setLabel('Tokeny')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('cc_action_ocr_stats')
                .setEmoji('🎯')
                .setLabel('Success Rate')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('panel_delete_server_data')
                .setEmoji('🗑️')
                .setLabel('Usuń dane serwera')
                .setStyle(ButtonStyle.Danger),
        );
        components.push(row4);

        return components;
    }
}

module.exports = AdminPanelService;
