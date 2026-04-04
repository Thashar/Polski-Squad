const fs = require('fs').promises;
const path = require('path');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const DATA_FILE = path.join(__dirname, '../data/kalkulator_embed.json');
const CALCULATOR_CHANNEL_ID = '1490035500126310460';

class KalkulatorEmbedService {
    constructor(config, databaseService, logger) {
        this.config = config;
        this.databaseService = databaseService;
        this.logger = logger;
        this.data = {
            messageId: null,
            requests: [],   // { userId, userNick, link, points, addedAt }
            helpers: []     // { helperId, helperNick, requestUserId, requestUserNick, assignedAt }
        };
    }

    async loadData() {
        try {
            const raw = await fs.readFile(DATA_FILE, 'utf8');
            const parsed = JSON.parse(raw);
            this.data.messageId = parsed.messageId || null;
            this.data.requests = Array.isArray(parsed.requests) ? parsed.requests : [];
            this.data.helpers = Array.isArray(parsed.helpers) ? parsed.helpers : [];
        } catch {
            this.data = { messageId: null, requests: [], helpers: [] };
        }
    }

    async saveData() {
        await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
        await fs.writeFile(DATA_FILE, JSON.stringify(this.data, null, 2), 'utf8');
    }

    /**
     * Buduje mapę userId -> pozycja rankingowa na podstawie danych Stalker Phase 1.
     * Zwraca Map<userId, position> (1-based, niższy numer = lepsza pozycja).
     */
    async buildRankingPositionMap(guildId) {
        try {
            const availableWeeks = await this.databaseService.getAvailableWeeks(guildId);
            if (!availableWeeks || availableWeeks.length === 0) return new Map();

            // Bierzemy ostatnie 54 tygodnie
            const last54 = availableWeeks.slice(-54);
            const playerMaxScores = new Map(); // userId -> maxScore

            for (const week of last54) {
                for (const clan of week.clans) {
                    const weekData = await this.databaseService.getPhase1Results(
                        guildId, week.weekNumber, week.year, clan
                    );
                    if (!weekData?.players) continue;
                    for (const player of weekData.players) {
                        if (player.userId && player.score > 0) {
                            const current = playerMaxScores.get(player.userId) || 0;
                            if (player.score > current) {
                                playerMaxScores.set(player.userId, player.score);
                            }
                        }
                    }
                }
            }

            const sorted = [...playerMaxScores.entries()].sort((a, b) => b[1] - a[1]);
            const positionMap = new Map();
            sorted.forEach(([userId], idx) => positionMap.set(userId, idx + 1));
            return positionMap;
        } catch (e) {
            this.logger.error('[KalkulatorEmbed] Błąd budowania rankingu:', e);
            return new Map();
        }
    }

    /**
     * Buduje embed z aktualnym stanem list
     */
    async buildEmbed(guild) {
        const rankingMap = await this.buildRankingPositionMap(guild.id);

        // Sortuj prośby: wyższa pozycja w rankingu → wyżej na liście
        const sortedRequests = [...this.data.requests].sort((a, b) => {
            const rA = rankingMap.get(a.userId) ?? 999999;
            const rB = rankingMap.get(b.userId) ?? 999999;
            return rA - rB;
        });

        // Pole prośby
        let requestsText = '*Brak aktywnych próśb o kalkulację*';
        if (sortedRequests.length > 0) {
            requestsText = sortedRequests.map(req => {
                const rankPos = rankingMap.get(req.userId);
                const rankStr = rankPos ? `#${rankPos}` : '#?';
                const date = new Date(req.addedAt).toLocaleString('pl-PL', {
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                });
                const beingHelped = this.data.helpers.some(h => h.requestUserId === req.userId);
                return `${rankStr} **${req.userNick}**${beingHelped ? ' 🔄' : ''} • ${req.points} pkt • ${date}`;
            }).join('\n');
        }

        // Pole pomagający
        let helpersText = '*Brak aktywnych pomagających*';
        if (this.data.helpers.length > 0) {
            helpersText = this.data.helpers.map(h => {
                const date = new Date(h.assignedAt).toLocaleString('pl-PL', {
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                });
                return `**${h.helperNick}** → **${h.requestUserNick}** • ${date}`;
            }).join('\n');
        }

        return new EmbedBuilder()
            .setTitle('🧮 Dzielenie Mocą Obliczeniową Kalkulatora')
            .setDescription(
                'System dzielenia zasobami kalkulatora między członkami klanu.\n' +
                'Użyj przycisków poniżej aby poprosić o kalkulację lub pomóc innym.'
            )
            .setColor(0x2ECC71)
            .addFields(
                { name: '📋 Prośby o kalkulację', value: requestsText },
                { name: '🤝 Pomagający', value: helpersText }
            )
            .setTimestamp()
            .setFooter({ text: 'Ostatnia aktualizacja' });
    }

    /**
     * Rząd przycisków dla embeda
     */
    buildButtons() {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('kalkulator_request')
                .setLabel('Poproś o kalkulację')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('kalkulator_help')
                .setLabel('Pomóż w przeliczeniu')
                .setStyle(ButtonStyle.Primary)
        );
    }

    /**
     * Inicjalizacja przy starcie — weryfikuje lub tworzy embed na kanale
     */
    async initialize(client) {
        await this.loadData();

        const channel = await client.channels.fetch(CALCULATOR_CHANNEL_ID).catch(() => null);
        if (!channel) {
            this.logger.error(`[KalkulatorEmbed] Nie znaleziono kanału: ${CALCULATOR_CHANNEL_ID}`);
            return;
        }

        if (this.data.messageId) {
            try {
                const msg = await channel.messages.fetch(this.data.messageId);
                const embed = await this.buildEmbed(channel.guild);
                await msg.edit({ embeds: [embed], components: [this.buildButtons()] });
                this.logger.info(`[KalkulatorEmbed] ✅ Embed zaktualizowany (ID: ${this.data.messageId})`);
                return;
            } catch {
                this.logger.info('[KalkulatorEmbed] Poprzedni embed nie istnieje, tworzę nowy');
            }
        }

        const embed = await this.buildEmbed(channel.guild);
        const msg = await channel.send({ embeds: [embed], components: [this.buildButtons()] });
        this.data.messageId = msg.id;
        await this.saveData();
        this.logger.info(`[KalkulatorEmbed] ✅ Embed utworzony (ID: ${msg.id})`);
    }

    /**
     * Aktualizuje embed na kanale
     */
    async updateEmbed(client) {
        if (!this.data.messageId) return;
        const channel = await client.channels.fetch(CALCULATOR_CHANNEL_ID).catch(() => null);
        if (!channel) return;
        try {
            const msg = await channel.messages.fetch(this.data.messageId);
            const embed = await this.buildEmbed(channel.guild);
            await msg.edit({ embeds: [embed], components: [this.buildButtons()] });
        } catch (e) {
            this.logger.error('[KalkulatorEmbed] Błąd aktualizacji embeda:', e);
        }
    }

    /**
     * Dodaje prośbę o kalkulację (zastępuje poprzednią od tego użytkownika)
     */
    async addRequest(userId, userNick, link, points, client) {
        // Jeśli użytkownik miał już prośbę i był obsługiwany, wyczyść też pomocnika
        this.data.helpers = this.data.helpers.filter(h => h.requestUserId !== userId);
        this.data.requests = this.data.requests.filter(r => r.userId !== userId);

        this.data.requests.push({ userId, userNick, link, points, addedAt: new Date().toISOString() });

        await this.saveData();
        await this.updateEmbed(client);
    }

    /**
     * Przydziela pomocnikowi pierwszą wolną prośbę (najsilniejszy w rankingu).
     * Zwraca prośbę lub null gdy brak wolnych.
     */
    async assignHelper(helperId, helperNick, client, guild) {
        const rankingMap = await this.buildRankingPositionMap(guild.id);
        const beingHelped = new Set(this.data.helpers.map(h => h.requestUserId));

        const available = this.data.requests
            .filter(r => !beingHelped.has(r.userId) && r.userId !== helperId)
            .sort((a, b) => {
                const rA = rankingMap.get(a.userId) ?? 999999;
                const rB = rankingMap.get(b.userId) ?? 999999;
                return rA - rB;
            });

        if (available.length === 0) return null;

        const request = available[0];
        this.data.helpers.push({
            helperId,
            helperNick,
            requestUserId: request.userId,
            requestUserNick: request.userNick,
            assignedAt: new Date().toISOString()
        });

        await this.saveData();
        await this.updateEmbed(client);
        return request;
    }

    /**
     * Finalizuje pomoc: wysyła DM właścicielowi i usuwa wpisy.
     * Zwraca { helper, request } lub null.
     */
    async completeHelp(helperId, client) {
        const helper = this.data.helpers.find(h => h.helperId === helperId);
        if (!helper) return null;

        const request = this.data.requests.find(r => r.userId === helper.requestUserId);

        this.data.helpers = this.data.helpers.filter(h => h.helperId !== helperId);
        this.data.requests = this.data.requests.filter(r => r.userId !== helper.requestUserId);

        await this.saveData();
        await this.updateEmbed(client);

        if (request) {
            try {
                const user = await client.users.fetch(helper.requestUserId);
                await user.send(
                    `✅ **${helper.helperNick}** przeliczył(a) Twój kalkulator!\n` +
                    `🔗 Zwrócony link: ${request.link}`
                );
            } catch {
                this.logger.warn(`[KalkulatorEmbed] Nie można wysłać DM do ${helper.requestUserId}`);
            }
        }

        return { helper, request };
    }

    getHelperByHelperId(helperId) {
        return this.data.helpers.find(h => h.helperId === helperId);
    }
}

module.exports = KalkulatorEmbedService;
