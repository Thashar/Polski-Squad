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
        return path.join(this.dataDir, 'guilds', guildId, 'achievements.json');
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
        const file = this._getDataFile(guildId);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
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

            // Dzienny licznik rekordów (same_day / same_day_3)
            const todayStr = new Date().toISOString().slice(0, 10);
            if (p.todayRecordDate !== todayStr) {
                p.todayRecordDate = todayStr;
                p.todayRecordCount = 0;
            }
            p.todayRecordCount = (p.todayRecordCount || 0) + 1;

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
     * Usuwa WSZYSTKIE osiągnięcia odblokowane od momentu cofniętego rekordu
     * (unlockedAt >= fromTimestamp). Osiągnięcia zdobyte WCZEŚNIEJ pozostają.
     * Wywoływane przy cofaniu wyniku gracza (community verification / panel Analizuj → Cofnij).
     * @param {string} guildId
     * @param {string} userId
     * @param {string} fromTimestamp - timestamp cofniętego rekordu (ISO)
     * @param {{ removedRecordCount?: number, previousRecord?: Object|null }} [opts]
     */
    async clearAchievementsAfter(guildId, userId, fromTimestamp, { removedRecordCount = 0, previousRecord = null } = {}) {
        try {
            const data = await this.loadData(guildId);
            if (!data[userId]) return;
            const userData = data[userId];
            const cutoff = new Date(fromTimestamp).getTime();
            for (const [id, info] of Object.entries(userData.unlocked || {})) {
                const ts = info?.unlockedAt ? new Date(info.unlockedAt).getTime() : 0;
                if (ts >= cutoff) delete userData.unlocked[id];
            }
            if (userData.progress) {
                userData.progress.recordCount = Math.max(0, (userData.progress.recordCount || 0) - removedRecordCount);
                const prevTs = previousRecord?.timestamp || null;
                userData.progress.lastRecordAt = prevTs;
                userData.progress.lastRecordBeatAt = fromTimestamp;
            }
            await this.saveData(guildId, data);
        } catch (err) {
            logger.error(`clearAchievementsAfter error (gracz ID ${userId}, serwer "${this.config.guilds?.find(g => g.id === guildId)?.tag || guildId}"): ${err.message}`);
        }
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

    async trackNonRecord(guildId, userId) {
        try {
            const data = await this.loadData(guildId);
            const userData = this._ensureUser(data, userId);
            const p = userData.progress;
            p.nonRecordCount = (p.nonRecordCount || 0) + 1;

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

    async trackCvApproved(guildId, userId) {
        try {
            const data = await this.loadData(guildId);
            const userData = this._ensureUser(data, userId);
            const p = userData.progress;
            p.cvApprovedCount = (p.cvApprovedCount || 0) + 1;

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

    async trackAiAnalyzed(guildId, userId) {
        try {
            const data = await this.loadData(guildId);
            const userData = this._ensureUser(data, userId);
            const p = userData.progress;
            p.aiRescuedCount = (p.aiRescuedCount || 0) + 1;

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

    async trackProfileSearch(guildId, userId) {
        try {
            const data = await this.loadData(guildId);
            const userData = this._ensureUser(data, userId);
            const p = userData.progress;
            p.profileSearches = (p.profileSearches || 0) + 1;

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
    async buildAchievementsView(guildId, userId, lang, view, category, crossServerGuildName = null) {
        const isPol = lang === 'pol';
        const t = (pol, eng) => isPol ? pol : eng;

        const data = await this.loadData(guildId);
        const userData = this._ensureUser(data, userId);
        const { unlocked, progress } = userData;

        let embed;
        if (view === 'overview') {
            ({ embed } = this._buildOverviewEmbed(unlocked, progress, t, isPol, crossServerGuildName));
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

        const lines = catAchs
            .filter(ach => !!unlocked[ach.id])
            .map(ach => {
                const rarity = RARITY[ach.rarity];
                const name = isPol ? ach.namePol : ach.nameEng;
                const desc = isPol ? ach.descPol : ach.descEng;
                const rarityLabel = rarity[isPol ? 'pol' : 'eng'];
                const date = new Date(unlocked[ach.id].unlockedAt).toLocaleDateString(isPol ? 'pl-PL' : 'en-GB');
                return `${ach.icon} (${rarity.emoji}) **${name}** *(${rarityLabel})*\n└ ${desc} — ${date}`;
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

    _buildOverviewEmbed(unlocked, progress, t, isPol, crossServerGuildName = null) {
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

        if (crossServerGuildName) {
            embed.addFields({
                name: t('ℹ️ Uwaga', 'ℹ️ Note'),
                value: t(
                    `Twoje osiągnięcia pochodzą z serwera **${crossServerGuildName}**, gdzie zapisany jest Twój najlepszy wynik.`,
                    `Your achievements come from **${crossServerGuildName}**, where your best score is recorded.`
                ),
                inline: false
            });
        }

        return { embed };
    }

    _buildComponents(activeKey, isPol, t) {
        const isOverview = activeKey === 'overview';

        const CATS = [
            { key: 'score',    pol: 'Wyniki',      eng: 'Scores',    emoji: '🏆' },
            { key: 'records',  pol: 'Rekordy',     eng: 'Records',   emoji: '🔁' },
            { key: 'bosses',   pol: 'Łowy',        eng: 'The Hunt',  emoji: '🎯' },
            { key: 'prestige', pol: 'Prestiż',     eng: 'Prestige',  emoji: '💎' },
            { key: 'explorer', pol: 'Eksplorator', eng: 'Explorer',  emoji: '🕵️' },
        ];

        const topRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('ach_overview')
                .setEmoji('📊')
                .setLabel(t('Podsumowanie', 'Overview'))
                .setStyle(isOverview ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(isOverview),
            new ButtonBuilder()
                .setCustomId('ach_check_player')
                .setEmoji('🔍')
                .setLabel(t('Sprawdź gracza', 'Check Player'))
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('ach_rank_start')
                .setEmoji('🏆')
                .setLabel(t('Ranking osiągnięć', 'Achievement Ranking'))
                .setStyle(ButtonStyle.Secondary)
        );

        const catRow = new ActionRowBuilder().addComponents(
            ...CATS.map(c => new ButtonBuilder()
                .setCustomId(`ach_cat_${c.key}`)
                .setEmoji(c.emoji)
                .setLabel(isPol ? c.pol : c.eng)
                .setStyle(activeKey === c.key ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(activeKey === c.key)
            )
        );

        return [topRow, catRow];
    }

    // ─── Widok osiągnięć innego gracza (bez opisów) ─────────────────────────

    async buildAchievementsViewForUser(guildId, targetUserId, targetUsername, viewerLang, view, category) {
        const isPol = viewerLang === 'pol';
        const t = (pol, eng) => isPol ? pol : eng;

        const data = await this.loadData(guildId);
        const unlocked = data[targetUserId]?.unlocked || {};

        let embed;
        if (view === 'overview') {
            ({ embed } = this._buildOverviewEmbedNoDesc(unlocked, t, isPol, targetUsername));
        } else {
            const cat = (category && CATEGORY_INFO[category]) ? category : 'score';
            ({ embed } = this._buildCategoryEmbedNoDesc(unlocked, cat, t, isPol, targetUsername));
        }

        const activeKey = view === 'overview' ? 'overview' : ((category && CATEGORY_INFO[category]) ? category : 'score');
        return { embed, components: this._buildComponentsForUser(activeKey, isPol, t, targetUserId, guildId) };
    }

    // Merge osiągnięć i postępu ze wszystkich serwerów dla jednego gracza
    async _mergeAchievements(allGuildIds, userId) {
        const ids = allGuildIds instanceof Set ? [...allGuildIds] : (Array.isArray(allGuildIds) ? allGuildIds : [allGuildIds]);
        const merged = { unlocked: {}, progress: null };

        for (const guildId of ids) {
            const data = await this.loadData(guildId);
            const ud = data[userId];
            if (!ud) continue;

            for (const [achId, info] of Object.entries(ud.unlocked || {})) {
                if (!merged.unlocked[achId] || info.unlockedAt < merged.unlocked[achId].unlockedAt)
                    merged.unlocked[achId] = info;
            }

            const p = ud.progress || {};
            if (!merged.progress) {
                merged.progress = {
                    ...p,
                    bossesEncountered: [...(p.bossesEncountered || [])],
                };
            } else {
                const mp = merged.progress;
                mp.recordCount    = (mp.recordCount    || 0) + (p.recordCount    || 0);
                mp.rankingViews   = (mp.rankingViews   || 0) + (p.rankingViews   || 0);
                mp.subscriptions  = (mp.subscriptions  || 0) + (p.subscriptions  || 0);
                mp.nonRecordCount = (mp.nonRecordCount || 0) + (p.nonRecordCount || 0);
                mp.cvApprovedCount  = (mp.cvApprovedCount  || 0) + (p.cvApprovedCount  || 0);
                mp.aiRescuedCount   = (mp.aiRescuedCount   || 0) + (p.aiRescuedCount   || 0);
                mp.profileSearches  = (mp.profileSearches  || 0) + (p.profileSearches  || 0);
                const allBosses = new Set([...(mp.bossesEncountered || []), ...(p.bossesEncountered || [])]);
                mp.bossesEncountered = [...allBosses];
                if (p.lastRecordAt && (!mp.lastRecordAt || p.lastRecordAt > mp.lastRecordAt)) mp.lastRecordAt = p.lastRecordAt;
                if (p.lastRecordBeatAt && (!mp.lastRecordBeatAt || p.lastRecordBeatAt > mp.lastRecordBeatAt)) mp.lastRecordBeatAt = p.lastRecordBeatAt;
                if (p.todayRecordDate) {
                    if (!mp.todayRecordDate || p.todayRecordDate > mp.todayRecordDate) {
                        mp.todayRecordDate  = p.todayRecordDate;
                        mp.todayRecordCount = p.todayRecordCount || 0;
                    } else if (p.todayRecordDate === mp.todayRecordDate) {
                        mp.todayRecordCount = (mp.todayRecordCount || 0) + (p.todayRecordCount || 0);
                    }
                }
            }
        }

        if (!merged.progress) {
            merged.progress = {
                recordCount: 0, bossesEncountered: [], rankingViews: 0, subscriptions: 0,
                lastRecordAt: null, lastRecordBeatAt: null, todayRecordDate: null, todayRecordCount: 0,
                nonRecordCount: 0, cvApprovedCount: 0, aiRescuedCount: 0, profileSearches: 0,
            };
        }

        return merged;
    }

    // Widok własnych osiągnięć zsumowany ze wszystkich serwerów
    async buildAchievementsViewGlobal(allGuildIds, userId, lang, view, category) {
        const isPol = lang === 'pol';
        const t = (pol, eng) => isPol ? pol : eng;
        const { unlocked, progress } = await this._mergeAchievements(allGuildIds, userId);

        let embed;
        if (view === 'overview') {
            ({ embed } = this._buildOverviewEmbed(unlocked, progress, t, isPol, null));
        } else {
            const cat = (category && CATEGORY_INFO[category]) ? category : 'score';
            ({ embed } = this._buildCategoryEmbed(unlocked, cat, t, isPol));
        }

        const activeKey = view === 'overview' ? 'overview' : ((category && CATEGORY_INFO[category]) ? category : 'score');
        const components = this._buildComponents(activeKey, isPol, t);
        return { embed, components };
    }

    // Widok osiągnięć innego gracza zsumowany ze wszystkich serwerów
    async buildAchievementsViewForUserGlobal(allGuildIds, targetUserId, targetUsername, viewerLang, view, category, fallbackGuildId = null) {
        const isPol = viewerLang === 'pol';
        const t = (pol, eng) => isPol ? pol : eng;
        const { unlocked } = await this._mergeAchievements(allGuildIds, targetUserId);

        let embed;
        if (view === 'overview') {
            ({ embed } = this._buildOverviewEmbedNoDesc(unlocked, t, isPol, targetUsername));
        } else {
            const cat = (category && CATEGORY_INFO[category]) ? category : 'score';
            ({ embed } = this._buildCategoryEmbedNoDesc(unlocked, cat, t, isPol, targetUsername));
        }

        const activeKey = view === 'overview' ? 'overview' : ((category && CATEGORY_INFO[category]) ? category : 'score');
        const guildIdForButtons = fallbackGuildId || (allGuildIds instanceof Set ? [...allGuildIds][0] : allGuildIds[0]) || 'all';
        return { embed, components: this._buildComponentsForUser(activeKey, isPol, t, targetUserId, guildIdForButtons) };
    }

    _buildCategoryEmbedNoDesc(unlocked, categoryKey, t, isPol, targetName) {
        const catInfo = CATEGORY_INFO[categoryKey];
        const catAchs = ACHIEVEMENTS.filter(a => a.category === categoryKey);
        const catLabel = isPol ? catInfo.pol : catInfo.eng;

        const lines = catAchs
            .filter(ach => !!unlocked[ach.id])
            .map(ach => {
                const rarity = RARITY[ach.rarity];
                const name = isPol ? ach.namePol : ach.nameEng;
                const rarityLabel = rarity[isPol ? 'pol' : 'eng'];
                const date = new Date(unlocked[ach.id].unlockedAt).toLocaleDateString(isPol ? 'pl-PL' : 'en-GB');
                return `${ach.icon} (${rarity.emoji}) **${name}** *(${rarityLabel})* — ${date}`;
            });

        const unlockedCount = catAchs.filter(a => unlocked[a.id]).length;
        const total = catInfo.hidden ? '?' : catAchs.length;

        return {
            embed: new EmbedBuilder()
                .setColor(0xf1c40f)
                .setTitle(`${catLabel} — ${targetName}`)
                .setDescription(lines.length > 0 ? lines.join('\n\n') : t('Brak osiągnięć w tej kategorii.', 'No achievements in this category.'))
                .setFooter({ text: t(`${unlockedCount}/${total} odblokowanych`, `${unlockedCount}/${total} unlocked`) })
        };
    }

    _buildOverviewEmbedNoDesc(unlocked, t, isPol, targetName) {
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

        return {
            embed: new EmbedBuilder()
                .setColor(0x9b59b6)
                .setTitle(t(`📊 Osiągnięcia — ${targetName}`, `📊 Achievements — ${targetName}`))
                .addFields({ name: t('Kategorie', 'Categories'), value: catLines.join('\n'), inline: false })
                .setFooter({ text: t(`${unlockedIds.size} odblokowanych`, `${unlockedIds.size} unlocked`) })
        };
    }

    _buildComponentsForUser(activeKey, isPol, t, targetUserId, targetGuildId) {
        const isOverview = activeKey === 'overview';

        const CATS = [
            { key: 'score',    pol: 'Wyniki',      eng: 'Scores',    emoji: '🏆' },
            { key: 'records',  pol: 'Rekordy',     eng: 'Records',   emoji: '🔁' },
            { key: 'bosses',   pol: 'Łowy',        eng: 'The Hunt',  emoji: '🎯' },
            { key: 'prestige', pol: 'Prestiż',     eng: 'Prestige',  emoji: '💎' },
            { key: 'explorer', pol: 'Eksplorator', eng: 'Explorer',  emoji: '🕵️' },
        ];

        const topRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`ach_vo_${targetUserId}_${targetGuildId}`)
                .setEmoji('📊')
                .setLabel(t('Podsumowanie', 'Overview'))
                .setStyle(isOverview ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(isOverview),
            new ButtonBuilder()
                .setCustomId('ach_vb')
                .setEmoji('↩️')
                .setLabel(t('Moje osiągnięcia', 'My Achievements'))
                .setStyle(ButtonStyle.Danger)
        );

        const catRow = new ActionRowBuilder().addComponents(
            ...CATS.map(c => new ButtonBuilder()
                .setCustomId(`ach_vc_${c.key}_${targetUserId}_${targetGuildId}`)
                .setEmoji(c.emoji)
                .setLabel(isPol ? c.pol : c.eng)
                .setStyle(activeKey === c.key ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(activeKey === c.key)
            )
        );

        return [topRow, catRow];
    }

    // ─── Ranking osiągnięć ───────────────────────────────────────────────────

    async getAchievementRanking(guildId, rankingService) {
        const [achieveData, ranking] = await Promise.all([
            this.loadData(guildId),
            rankingService.loadRanking(guildId)
        ]);
        const total = ACHIEVEMENTS.length;
        const playerMap = new Map();

        for (const [userId, data] of Object.entries(ranking)) {
            const count = achieveData[userId]?.unlocked
                ? Object.keys(achieveData[userId].unlocked).length
                : 0;
            playerMap.set(userId, { userId, username: data.username || userId, count, total });
        }

        return Array.from(playerMap.values())
            .sort((a, b) => b.count - a.count || a.username.localeCompare(b.username));
    }

    async getGlobalAchievementRanking(allGuildIds, rankingService) {
        const total = ACHIEVEMENTS.length;
        const bestPerPlayer = new Map();

        await Promise.all(Array.from(allGuildIds).map(async (guildId) => {
            const [achieveData, ranking] = await Promise.all([
                this.loadData(guildId),
                rankingService.loadRanking(guildId)
            ]);

            for (const [userId, data] of Object.entries(ranking)) {
                const count = achieveData[userId]?.unlocked
                    ? Object.keys(achieveData[userId].unlocked).length
                    : 0;
                const existing = bestPerPlayer.get(userId);
                if (!existing || count > existing.count) {
                    bestPerPlayer.set(userId, {
                        userId,
                        username: data.username || userId,
                        count,
                        total,
                        sourceGuildId: guildId
                    });
                }
            }
        }));

        return Array.from(bestPerPlayer.values())
            .sort((a, b) => b.count - a.count || a.username.localeCompare(b.username));
    }

    async getAchievementRankingByRole(guildId, roleId, guild, rankingService, roleRankingConfigService) {
        const allPlayers = await this.getAchievementRanking(guildId, rankingService);
        const playerIds = allPlayers.map(p => p.userId);
        const membersWithRole = await roleRankingConfigService.getMembersWithRole(guild, roleId, playerIds);
        return allPlayers.filter(p => membersWithRole.has(p.userId));
    }

    buildAchRankingEmbed(players, page, perPage, mode, guildName, isPol, iconUrl = null, callerId = null) {
        const t = (pol, eng) => isPol ? pol : eng;
        const start = page * perPage;
        const pageItems = players.slice(start, start + perPage);
        const totalPages = Math.ceil(players.length / perPage) || 1;

        let title;
        if (mode === 'global') {
            title = t('🏆 Ranking Osiągnięć — 🌐 Global', '🏆 Achievement Ranking — 🌐 Global');
        } else if (mode === 'role') {
            title = t(`🏆 Ranking Osiągnięć — ${guildName}`, `🏆 Achievement Ranking — ${guildName}`);
        } else {
            title = t(`🏆 Ranking Osiągnięć — ${guildName}`, `🏆 Achievement Ranking — ${guildName}`);
        }

        let guildTagMap = null;
        if (mode === 'global') {
            guildTagMap = new Map(this.config.getAllGuilds().map(g => [g.id, g.tag]));
        }

        const lines = pageItems.map((p, i) => {
            const pos = start + i + 1;
            const medal = pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : `**#${pos}**`;
            const tag = guildTagMap ? (guildTagMap.get(p.sourceGuildId) || '') : '';
            const tagSuffix = tag ? ` • ${tag}` : '';
            const name = p.userId === callerId ? `**${p.username}**` : p.username;
            return `${medal} ${name} — **${p.count}**${tagSuffix}`;
        });

        const embed = new EmbedBuilder()
            .setColor(mode === 'global' ? 0x5865f2 : 0xf1c40f)
            .setTitle(title)
            .setDescription(lines.length > 0 ? lines.join('\n') : t('Brak danych.', 'No data.'))
            .setFooter({ text: t(
                `Strona ${page + 1}/${totalPages} • ${players.length} graczy`,
                `Page ${page + 1}/${totalPages} • ${players.length} players`
            ) });
        if (iconUrl) embed.setThumbnail(iconUrl);
        return embed;
    }

    createAchRankingButtons(page, totalPages, mode, guildId, guildName, roleRows, isPol, userPage = null, parentGuildId = null, parentGuildName = null) {
        const t = (pol, eng) => isPol ? pol : eng;

        const switchBtnBase = (mode === 'server' || mode === 'role')
            ? new ButtonBuilder()
                .setCustomId('ach_rank_global')
                .setEmoji('🌐')
                .setLabel(t('Global', 'Global'))
                .setStyle(ButtonStyle.Secondary)
            : (() => {
                const b = new ButtonBuilder()
                    .setCustomId(parentGuildId ? `ach_rank_srv_${parentGuildId}` : 'ach_rank_no_srv')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(!parentGuildId);
                if (parentGuildName) {
                    b.setLabel(parentGuildName.substring(0, 80));
                } else {
                    b.setEmoji('🏠').setLabel(t('Serwer', 'Server'));
                }
                return b;
            })();
        const switchBtn = switchBtnBase;

        const navRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('ach_rank_prev')
                .setEmoji('◀️')
                .setLabel(t('Poprzednia', 'Previous'))
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId('ach_rank_mypos')
                .setEmoji('📍')
                .setLabel(t('Moja pozycja', 'My Position'))
                .setStyle(ButtonStyle.Primary)
                .setDisabled(userPage === null),
            new ButtonBuilder()
                .setCustomId('ach_rank_next')
                .setEmoji('▶️')
                .setLabel(t('Następna', 'Next'))
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page >= totalPages - 1),
            switchBtn,
        );

        const navRow2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('ach_rank_back')
                .setEmoji('↩️')
                .setLabel(t('Wybór serwerów', 'Server Selection'))
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('ach_rank_go_ranking')
                .setEmoji('↩️')
                .setLabel(t('Wybór rankingów', 'Ranking Selection'))
                .setStyle(ButtonStyle.Danger),
        );

        return [navRow, navRow2, ...roleRows];
    }

    createAchRankingRoleButtons(roleRankings, guildId, activeRoleId = null) {
        const rows = [];
        for (let i = 0; i < roleRankings.length; i += 5) {
            const row = new ActionRowBuilder();
            for (const rr of roleRankings.slice(i, i + 5)) {
                const isActive = rr.roleId === activeRoleId;
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`ach_rank_role_${guildId}_${rr.roleId}`)
                        .setLabel(rr.roleName.substring(0, 80))
                        .setStyle(isActive ? ButtonStyle.Secondary : ButtonStyle.Primary)
                        .setDisabled(isActive)
                );
            }
            rows.push(row);
        }
        return rows;
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
