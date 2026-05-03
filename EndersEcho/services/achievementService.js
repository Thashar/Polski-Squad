'use strict';

const fs = require('fs').promises;
const path = require('path');
const { ACHIEVEMENTS, RARITY, CATEGORY_INFO } = require('../config/achievements');
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');

const PER_PAGE = 10;

class AchievementService {
    constructor(config) {
        this.config = config;
        this.dataDir = config.ranking?.dataDir || path.join(__dirname, '../data');
    }

    _getDataFile(guildId) {
        return path.join(this.dataDir, `achievements_${guildId}.json`);
    }

    async loadData(guildId) {
        try {
            const raw = await fs.readFile(this._getDataFile(guildId), 'utf8');
            return JSON.parse(raw);
        } catch {
            return {};
        }
    }

    async saveData(guildId, data) {
        await fs.writeFile(this._getDataFile(guildId), JSON.stringify(data, null, 2), 'utf8');
    }

    _ensureUser(data, userId) {
        if (!data[userId]) {
            data[userId] = {
                unlocked: {},
                progress: {
                    recordCount: 0,
                    bossesEncountered: [],
                    rankingViews: 0,
                    subscriptions: 0,
                    lastRecordAt: null,
                    lastRecordBeatAt: null,
                },
            };
        }
        return data[userId];
    }

    /**
     * Called after a successful /update (not dryRun).
     * Returns array of achievement IDs to show in the record embed
     * (those unlocked since the previous record beat).
     *
     * @param {string} guildId
     * @param {string} userId
     * @param {{ scoreValue, bossName, isNewRecord, prevScoreValue, currentPosition }} ctx
     * @returns {Promise<string[]>}
     */
    async processSubmission(guildId, userId, ctx) {
        if (!ctx.isNewRecord) return [];

        try {
            const data = await this.loadData(guildId);
            const userData = this._ensureUser(data, userId);
            const p = userData.progress;

            const prevLastBeat = p.lastRecordBeatAt;

            // Aktualizuj progress przed sprawdzeniem warunków
            p.recordCount = (p.recordCount || 0) + 1;

            if (ctx.bossName) {
                const boss = ctx.bossName.trim();
                if (boss && boss !== 'Nieznany' && boss !== 'Unknown') {
                    if (!p.bossesEncountered) p.bossesEncountered = [];
                    const lc = boss.toLowerCase();
                    if (!p.bossesEncountered.some(b => b.toLowerCase() === lc)) {
                        p.bossesEncountered.push(boss);
                    }
                }
            }

            const nowIso = new Date().toISOString();

            // Sprawdź i odblokuj osiągnięcia
            for (const ach of ACHIEVEMENTS) {
                if (userData.unlocked[ach.id]) continue;
                try {
                    if (ach.check(p, ctx)) {
                        userData.unlocked[ach.id] = { unlockedAt: nowIso };
                    }
                } catch {}
            }

            // Zbierz osiągnięcia do pokazania w embeddzie (odblokowane od ostatniego pobicia rekordu)
            const toShow = Object.entries(userData.unlocked)
                .filter(([, info]) => !prevLastBeat || info.unlockedAt > prevLastBeat)
                .map(([id]) => id);

            // Zapisz timestamp PO zebraniu listy (żeby prevLastBeat był sprzed obecnego rekordu)
            p.lastRecordAt = nowIso;
            p.lastRecordBeatAt = nowIso;

            await this.saveData(guildId, data);
            return toShow;
        } catch {
            return [];
        }
    }

    /**
     * Usuwa osiągnięcia powiązane z wynikiem i pobijaniem rekordów (kategorie 'score' i 'records')
     * oraz resetuje powiązane pola progress. Wywoływane przy usunięciu gracza z rankingu przez admina.
     */
    async clearUserAchievements(guildId, userId) {
        try {
            const data = await this.loadData(guildId);
            if (!data[userId]) return;
            const userData = data[userId];
            const scoreAndRecordIds = new Set(
                ACHIEVEMENTS.filter(a => a.category === 'score' || a.category === 'records').map(a => a.id)
            );
            for (const id of scoreAndRecordIds) {
                delete userData.unlocked[id];
            }
            userData.progress.recordCount = 0;
            userData.progress.lastRecordAt = null;
            userData.progress.lastRecordBeatAt = null;
            await this.saveData(guildId, data);
        } catch {}
    }

    /**
     */
    async trackRankingView(guildId, userId) {
        try {
            const data = await this.loadData(guildId);
            const userData = this._ensureUser(data, userId);
            const p = userData.progress;
            p.rankingViews = (p.rankingViews || 0) + 1;

            const nowIso = new Date().toISOString();
            for (const ach of ACHIEVEMENTS) {
                if (!ach.hidden || userData.unlocked[ach.id] || ach.category !== 'explorer') continue;
                try {
                    if (ach.check(p, {})) userData.unlocked[ach.id] = { unlockedAt: nowIso };
                } catch {}
            }

            await this.saveData(guildId, data);
        } catch {}
    }

    /**
     * Śledzi aktywację subskrypcji — może odblokować ukryte osiągnięcia eksploratora.
     */
    async trackSubscription(guildId, userId) {
        try {
            const data = await this.loadData(guildId);
            const userData = this._ensureUser(data, userId);
            const p = userData.progress;
            p.subscriptions = (p.subscriptions || 0) + 1;

            const nowIso = new Date().toISOString();
            for (const ach of ACHIEVEMENTS) {
                if (!ach.hidden || userData.unlocked[ach.id] || ach.category !== 'explorer') continue;
                try {
                    if (ach.check(p, {})) userData.unlocked[ach.id] = { unlockedAt: nowIso };
                } catch {}
            }

            await this.saveData(guildId, data);
        } catch {}
    }

    /**
     * Tworzy embed i komponenty dla komendy /achievements.
     * @param {string} guildId
     * @param {string} userId
     * @param {string} lang - 'pol' | 'eng'
     * @param {string} tab  - 'unlocked' | 'overview'
     * @param {number} page - 0-based
     * @returns {Promise<{ embed: EmbedBuilder, components: ActionRowBuilder[], totalPages: number, currentPage: number }>}
     */
    async buildAchievementsView(guildId, userId, lang, tab, page) {
        const isPol = lang === 'pol';
        const t = (pol, eng) => isPol ? pol : eng;

        const data = await this.loadData(guildId);
        const userData = this._ensureUser(data, userId);
        const { unlocked, progress } = userData;

        let embed, totalPages, currentPage;

        if (tab === 'overview') {
            ({ embed, totalPages, currentPage } = this._buildOverviewEmbed(unlocked, progress, t, isPol));
        } else {
            ({ embed, totalPages, currentPage } = this._buildUnlockedEmbed(unlocked, t, isPol, page));
        }

        const components = this._buildComponents(tab, currentPage, totalPages, t);
        return { embed, components, totalPages, currentPage };
    }

    _buildUnlockedEmbed(unlocked, t, isPol, page) {
        const unlockedList = Object.entries(unlocked)
            .map(([id, info]) => ({ id, unlockedAt: info.unlockedAt }))
            .sort((a, b) => (b.unlockedAt > a.unlockedAt ? 1 : -1)); // najnowsze pierwsze

        const totalPages = Math.max(1, Math.ceil(unlockedList.length / PER_PAGE));
        const currentPage = Math.max(0, Math.min(page, totalPages - 1));
        const pageItems = unlockedList.slice(currentPage * PER_PAGE, (currentPage + 1) * PER_PAGE);

        const embed = new EmbedBuilder()
            .setColor(0xf1c40f)
            .setTitle(t('🏆 Twoje Osiągnięcia', '🏆 Your Achievements'))
            .setFooter({ text: t(
                `Strona ${currentPage + 1} z ${totalPages} • ${unlockedList.length} odblokowanych`,
                `Page ${currentPage + 1} of ${totalPages} • ${unlockedList.length} unlocked`
            ) });

        if (pageItems.length === 0) {
            embed.setDescription(t(
                '❌ Nie masz jeszcze żadnych osiągnięć. Graj i bądź aktywny!',
                '❌ No achievements yet. Play and stay active!'
            ));
        } else {
            const lines = pageItems.map(({ id, unlockedAt }) => {
                const ach = ACHIEVEMENTS.find(a => a.id === id);
                if (!ach) return null;
                const rarity = RARITY[ach.rarity];
                const name = isPol ? ach.namePol : ach.nameEng;
                const desc = isPol ? ach.descPol : ach.descEng;
                const date = new Date(unlockedAt).toLocaleDateString(isPol ? 'pl-PL' : 'en-GB');
                const rarityLabel = rarity[isPol ? 'pol' : 'eng'];
                return `${ach.icon} (${rarity.emoji}) **${name}** *(${rarityLabel})*\n└ ${desc} — ${date}`;
            }).filter(Boolean);
            embed.setDescription(lines.join('\n\n'));
        }

        return { embed, totalPages, currentPage };
    }

    _buildOverviewEmbed(unlocked, progress, t, isPol) {
        const unlockedIds = new Set(Object.keys(unlocked));

        const categoryOrder = Object.entries(CATEGORY_INFO).sort(([, a], [, b]) => {
            if (a.hidden && !b.hidden) return 1;
            if (!a.hidden && b.hidden) return -1;
            return 0;
        });
        const catLines = categoryOrder.map(([catKey, catLabel]) => {
            const catAchs = ACHIEVEMENTS.filter(a => a.category === catKey);
            const catUnlocked = catAchs.filter(a => unlockedIds.has(a.id)).length;
            const label = isPol ? catLabel.pol : catLabel.eng;
            // Ukryte kategorie pokazują liczbę odblokowanych, ale total jako "?"
            const total = catLabel.hidden ? '?' : catAchs.length;
            return `${label}: **${catUnlocked}/${total}**`;
        });

        const embed = new EmbedBuilder()
            .setColor(0x9b59b6)
            .setTitle(t('📊 Przegląd Osiągnięć', '📊 Achievement Overview'))
            .addFields(
                { name: t('Kategorie', 'Categories'), value: catLines.join('\n'), inline: false },
            )
            .setFooter({ text: t(
                `${unlockedIds.size} odblokowanych`,
                `${unlockedIds.size} unlocked`
            ) });

        return { embed, totalPages: 1, currentPage: 0 };
    }

    _buildComponents(tab, currentPage, totalPages, t) {
        const isUnlocked = tab === 'unlocked';

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`ach_view_unlocked_${currentPage - 1}`)
                .setLabel('◀')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!isUnlocked || currentPage <= 0),
            new ButtonBuilder()
                .setCustomId(`ach_view_unlocked_${currentPage + 1}`)
                .setLabel('▶')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!isUnlocked || currentPage >= totalPages - 1),
            new ButtonBuilder()
                .setCustomId('ach_view_unlocked_0')
                .setLabel(t('🏆 Odblokowane', '🏆 Unlocked'))
                .setStyle(isUnlocked ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(isUnlocked),
            new ButtonBuilder()
                .setCustomId('ach_view_overview_0')
                .setLabel(t('📊 Podsumowanie', '📊 Overview'))
                .setStyle(!isUnlocked ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(!isUnlocked),
        );

        return [row];
    }

    /**
     * Buduje tekst pola "Nowe osiągnięcia" do embeda rekordu.
     * @param {string[]} achievementIds
     * @param {string} lang
     * @returns {string|null}
     */
    buildNewAchievementsFieldValue(achievementIds, lang) {
        if (!achievementIds || achievementIds.length === 0) return null;
        const isPol = lang === 'pol';

        const lines = achievementIds.map(id => {
            const ach = ACHIEVEMENTS.find(a => a.id === id);
            if (!ach) return null;
            const rarity = RARITY[ach.rarity];
            const name = isPol ? ach.namePol : ach.nameEng;
            return `${ach.icon} (${rarity.emoji}) **${name}**`;
        }).filter(Boolean);

        return lines.length > 0 ? lines.join('\n') : null;
    }
}

module.exports = AchievementService;
