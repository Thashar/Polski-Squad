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
     * Cofa konkretne osiągnięcia zdobyte przy danym submission (community verification).
     * Usuwa podane achievementIds z unlocked, dekrementuje recordCount o 1,
     * przywraca lastRecordAt i lastRecordBeatAt do wartości z poprzedniego rekordu.
     * @param {string} guildId
     * @param {string} userId
     * @param {string[]} achievementIds - ID osiągnięć zdobytych tym rekordem
     * @param {Object|null} previousRecord - poprzedni rekord ({ timestamp } lub null)
     */
    async revertSubmissionAchievements(guildId, userId, achievementIds, previousRecord) {
        try {
            const data = await this.loadData(guildId);
            if (!data[userId]) return;
            const userData = data[userId];
            for (const id of achievementIds) {
                delete userData.unlocked[id];
            }
            userData.progress.recordCount = Math.max(0, (userData.progress.recordCount || 1) - 1);
            const prevTs = previousRecord?.timestamp || null;
            userData.progress.lastRecordAt = prevTs;
            userData.progress.lastRecordBeatAt = prevTs;
            await this.saveData(guildId, data);
        } catch (err) {
            logger.error(`revertSubmissionAchievements error (gracz ID ${userId}, serwer "${this.config.guilds?.find(g => g.id === guildId)?.tag || guildId}"): ${err.message}`);
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
     * Usuwa WSZYSTKIE osiągnięcia i cały progress gracza na danym serwerze.
     * Wywoływane przez head admina z poziomu /manage → Reset osiągnięć.
     */
    async resetAllAchievements(guildId, userId) {
        try {
            const data = await this.loadData(guildId);
            if (!data[userId]) return;
            delete data[userId];
            await this.saveData(guildId, data);
        } catch {}
    }

    async removeOneAchievement(guildId, userId, achId) {
        try {
            const data = await this.loadData(guildId);
            if (!data[userId]?.unlocked?.[achId]) return;
            delete data[userId].unlocked[achId];
            await this.saveData(guildId, data);
        } catch {}
    }

    async getUnlockedAchievements(guildId, userId) {
        try {
            const data = await this.loadData(guildId);
            const unlocked = data[userId]?.unlocked || {};
            return ACHIEVEMENTS.filter(a => unlocked[a.id]).map(a => ({ ...a, unlockedAt: unlocked[a.id].unlockedAt }));
        } catch { return []; }
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
     * @param {string} view - 'cat' | 'overview'
     * @param {string|null} category - klucz kategorii (gdy view='cat')
     * @returns {Promise<{ embed: EmbedBuilder, components: ActionRowBuilder[] }>}
     */
    async buildAchievementsView(guildId, userId, lang, view, category) {
        const isPol = lang === 'pol';
        const t = (pol, eng) => isPol ? pol : eng;

        const data = await this.loadData(guildId);
        const userData = this._ensureUser(data, userId);
        const { unlocked, progress } = userData;

        let embed;
        if (view === 'overview') {
            ({ embed } = this._buildOverviewEmbed(unlocked, progress, t, isPol));
        } else {
            const cat = (category && CATEGORY_INFO[category]) ? category : 'score';
            ({ embed } = this._buildCategoryEmbed(unlocked, cat, t, isPol));
        }

        const activeKey = view === 'overview' ? 'overview' : ((category && CATEGORY_INFO[category]) ? category : 'score');
        const components = this._buildComponents(activeKey, isPol, t);
        return { embed, components };
    }

    _buildCategoryEmbed(unlocked, categoryKey, t, isPol) {
        const catInfo = CATEGORY_INFO[categoryKey];
        const catAchs = ACHIEVEMENTS.filter(a => a.category === categoryKey);
        const catLabel = isPol ? catInfo.pol : catInfo.eng;

        const lines = catAchs.map(ach => {
            const isUnlocked = !!unlocked[ach.id];
            const rarity = RARITY[ach.rarity];
            const name = isPol ? ach.namePol : ach.nameEng;
            const desc = isPol ? ach.descPol : ach.descEng;
            const rarityLabel = rarity[isPol ? 'pol' : 'eng'];
            if (isUnlocked) {
                const date = new Date(unlocked[ach.id].unlockedAt).toLocaleDateString(isPol ? 'pl-PL' : 'en-GB');
                return `${rarity.emoji} **${name}** *(${rarityLabel})*\n└ ${desc} — ${date}`;
            }
            if (catInfo.hidden) return `🔒 **???** *(${rarityLabel})*`;
            return `🔒 ~~${name}~~ *(${rarityLabel})*\n└ ${desc}`;
        });

        const unlockedCount = catAchs.filter(a => unlocked[a.id]).length;
        const total = catInfo.hidden ? '?' : catAchs.length;

        const embed = new EmbedBuilder()
            .setColor(0xf1c40f)
            .setTitle(catLabel)
            .setDescription(lines.length > 0 ? lines.join('\n\n') : t('Brak osiągnięć w tej kategorii.', 'No achievements in this category.'))
            .setFooter({ text: t(`${unlockedCount}/${total} odblokowanych`, `${unlockedCount}/${total} unlocked`) });

        return { embed };
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

        return { embed };
    }

    _buildComponents(activeKey, isPol, t) {
        const isOverview = activeKey === 'overview';

        const CATS = [
            { key: 'score',    pol: '🏆 Wyniki',       eng: '🏆 Scores'    },
            { key: 'records',  pol: '🔁 Rekordy',      eng: '🔁 Records'   },
            { key: 'bosses',   pol: '🎯 Łowy',         eng: '🎯 The Hunt'  },
            { key: 'prestige', pol: '💎 Prestiż',      eng: '💎 Prestige'  },
            { key: 'explorer', pol: '🕵️ Eksplorator',  eng: '🕵️ Explorer'  },
        ];

        const catRow = new ActionRowBuilder().addComponents(
            ...CATS.map(c => new ButtonBuilder()
                .setCustomId(`ach_cat_${c.key}`)
                .setLabel(isPol ? c.pol : c.eng)
                .setStyle(activeKey === c.key ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(activeKey === c.key)
            )
        );

        const overviewRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('ach_overview')
                .setLabel(t('📊 Podsumowanie', '📊 Overview'))
                .setStyle(isOverview ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(isOverview)
        );

        return [catRow, overviewRow];
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
