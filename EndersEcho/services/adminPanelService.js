const fs = require('fs').promises;
const path = require('path');
const { EmbedBuilder } = require('discord.js');
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

        const embeds = await this._buildEmbeds();

        const channel = await this._client.channels.fetch(this._channelId).catch(() => null);
        if (!channel) {
            logger.warn(`Panel Centrum Dowodzenia: kanał ${this._channelId} niedostępny`);
            return;
        }

        if (this._messageId) {
            const msg = await channel.messages.fetch(this._messageId).catch(() => null);
            if (msg) {
                await msg.edit({ embeds });
                return;
            }
            // Wiadomość usunięta — wyczyść ID, wyślij nową
            this._messageId = null;
        }

        const newMsg = await channel.send({ embeds });
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

        const lastUpdated = now.toLocaleString('pl-PL', {
            timeZone: 'Europe/Warsaw',
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });

        return [
            this._buildStatusEmbed(serverData.configured, lastUpdated),
            this._buildOcrEmbed(ocrStats, pendingCvCount),
            this._buildPlayersEmbed(globalRanking, blockedUsersArr, activeCooldownCount),
            this._buildCostEmbed(todayTokens),
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

        return { configured, unconfigured, absent };
    }

    _buildStatusEmbed(configuredServers, lastUpdated) {
        const uptime = fmtUptime(Date.now() - this._startTime);
        const configuredCount = configuredServers.length;

        // Następny Global TOP10
        let nextTop10 = '—';
        const g10 = this._services.globalTop10Service;
        try {
            if (g10?._cfg?.nextTrigger && g10?._cfg?.enabled) {
                nextTop10 = fmtTs(g10._cfg.nextTrigger);
            }
        } catch { /* pomiń */ }

        const aiEnabled = this._config.ocr?.useAI !== false;

        return new EmbedBuilder()
            .setColor(0xFF6B35)
            .setTitle('📡 Centrum Dowodzenia — EndersEcho')
            .addFields(
                { name: '⏱️ Uptime', value: uptime, inline: true },
                { name: '🖥️ Serwery', value: `${configuredCount}`, inline: true },
                { name: '🌐 AI OCR', value: aiEnabled ? '✅ Włączone' : '❌ Wyłączone', inline: true },
                { name: '📅 Następny Global TOP10', value: nextTop10, inline: false },
            )
            .setFooter({ text: `Ostatnia aktualizacja: ${lastUpdated}` });
    }

    _buildOcrEmbed(ocrStats, pendingCvCount) {
        const at = ocrStats?.allTime ?? { total: 0, success: 0, adminFixed: 0 };
        const rs = ocrStats?.resettable ?? { total: 0, success: 0, adminFixed: 0 };

        const atFixed = at.adminFixed || 0;
        const rsFixed = rs.adminFixed || 0;
        const atRate = at.total > 0 ? `${(((at.total - atFixed) / at.total) * 100).toFixed(1)}%` : '—';
        const rsRate = rs.total > 0 ? `${(((rs.total - rsFixed) / rs.total) * 100).toFixed(1)}%` : '—';

        let lastAnalysis = '—';
        if (this._lastRecord) {
            const lr = this._lastRecord;
            const boss = lr.bossName ? ` (${lr.bossName})` : '';
            lastAnalysis = `**${lr.userName}** — ${lr.score}${boss} • ${timeSince(lr.timestamp)}`;
        }

        return new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('📊 Statystyki OCR')
            .addFields(
                { name: '📈 Łącznie analiz', value: `${at.total}`, inline: true },
                { name: '🔄 Od ostatniego resetu', value: `${rs.total}`, inline: true },
                { name: '✅ Success Rate', value: `${atRate} (reset: ${rsRate})`, inline: true },
                { name: '🔧 Interwencje admina', value: `Łącznie: **${atFixed}** | Reset: **${rsFixed}**`, inline: true },
                { name: '🗳️ Oczekujące CV', value: `${pendingCvCount}`, inline: true },
                { name: '📸 Ostatnia analiza', value: lastAnalysis, inline: false },
            );
    }

    _buildPlayersEmbed(globalRanking, blockedUsersArr, activeCooldownCount) {
        const totalPlayers = globalRanking.length;
        const blockedCount = Array.isArray(blockedUsersArr) ? blockedUsersArr.length : 0;
        const medals = ['🥇', '🥈', '🥉'];

        const fields = [
            { name: '👥 Łącznie graczy', value: `${totalPlayers}`, inline: true },
            { name: '⏳ Aktywne cooldowny', value: `${activeCooldownCount}`, inline: true },
            { name: '🔒 Zablokowanych', value: `${blockedCount}`, inline: true },
        ];

        const top3 = (globalRanking || []).slice(0, 3);
        for (let i = 0; i < top3.length; i++) {
            const p = top3[i];
            const boss = p.bossName ? ` • ${p.bossName}` : '';
            fields.push({
                name: `${medals[i]} #${i + 1} — ${p.username || p.userId}`,
                value: `${p.score}${boss}`,
                inline: true,
            });
        }

        // Dopełnij do wielokrotności 3 (Discord wymaga równych rzędów inline)
        while (fields.length % 3 !== 0 && top3.length > 0) {
            fields.push({ name: '​', value: '​', inline: true });
        }

        return new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('🌍 Gracze Globalnie')
            .addFields(fields);
    }

    _buildCostEmbed(todayTokens) {
        const { promptTokens, outputTokens, requests, cost } = todayTokens;
        return new EmbedBuilder()
            .setColor(0xFEE75C)
            .setTitle('💰 Koszty AI — Dzisiaj')
            .addFields(
                { name: '📤 Requesty', value: `${requests}`, inline: true },
                { name: '🔤 Tokeny IN', value: fmtTokens(promptTokens), inline: true },
                { name: '🔤 Tokeny OUT', value: fmtTokens(outputTokens), inline: true },
                { name: '💵 Szacowany koszt', value: fmtCost(cost), inline: true },
                { name: '🔢 Łącznie tokenów', value: fmtTokens(promptTokens + outputTokens), inline: true },
                { name: '​', value: '​', inline: true },
            );
    }

    _buildServersEmbed({ configured, unconfigured, absent }) {
        const lines = [];

        if (configured.length > 0) {
            lines.push('**✅ Skonfigurowane — bot jest**');
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
                .setTitle('🖥️ Status Serwerów')
                .setDescription('Brak skonfigurowanych serwerów.');
        }

        return new EmbedBuilder()
            .setColor(0xEB459E)
            .setTitle('🖥️ Status Serwerów')
            .setDescription(lines.join('\n'));
    }
}

module.exports = AdminPanelService;
