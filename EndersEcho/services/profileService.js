const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const BOSSES_PER_PAGE = 15;

/**
 * Serwis profilu gracza — zbiera dane z wielu systemów i buduje embedy.
 */
class ProfileService {
    constructor(services) {
        this._rankingService       = services.rankingService;
        this._bossRecordService    = services.bossRecordService;
        this._bossAliasService     = services.bossAliasService;
        this._roleService          = services.roleService;
        this._roleRankingCfg       = services.roleRankingConfigService;
        this._guildConfigService   = services.guildConfigService;
    }

    /**
     * Zbiera wszystkie dane gracza ze wszystkich serwisów.
     * @param {string} guildId - serwer kontekstowy (skąd pochodzi zapytanie)
     * @param {string} targetUserId
     * @param {Set|string[]} allGuildIds
     * @param {import('discord.js').Client} client
     * @returns {Promise<Object>} profileData
     */
    async collectData(guildId, targetUserId, allGuildIds, client) {
        const guild = client.guilds.cache.get(guildId);
        const guildConfig = this._guildConfigService?.getConfig(guildId);

        const [sortedPlayers, globalRanking, allBossRecords, knownBossNamesRaw, bossGlobalPositions] = await Promise.all([
            this._rankingService.getSortedPlayers(guildId).catch(() => []),
            this._rankingService.getGlobalRanking(allGuildIds).catch(() => []),
            this._bossRecordService.getUserBossRecordsAllGuilds(allGuildIds, targetUserId).catch(() => ({})),
            Promise.resolve(this._bossAliasService.getExtraEnglishNames()),
            this._bossRecordService.getPlayerBossPositions(allGuildIds, targetUserId).catch(() => ({})),
        ]);

        // Pozycja na serwerze
        const serverIdx = sortedPlayers.findIndex(p => p.userId === targetUserId);
        const serverRecord   = serverIdx !== -1 ? sortedPlayers[serverIdx] : null;
        const serverPosition = serverIdx !== -1 ? serverIdx + 1 : null;

        // Pozycja globalna
        const globalIdx    = globalRanking.findIndex(p => p.userId === targetUserId);
        const globalRecord = globalIdx !== -1 ? globalRanking[globalIdx] : null;
        const globalPosition = globalIdx !== -1 ? globalIdx + 1 : null;

        // Wycinek globalnego rankingu (gracz ±1)
        const snippetPlayers = [];
        if (globalIdx !== -1) {
            const start = Math.max(0, globalIdx - 1);
            const end   = Math.min(globalRanking.length, globalIdx + 2);
            for (let i = start; i < end; i++) {
                snippetPlayers.push({
                    ...globalRanking[i],
                    position: i + 1,
                    isTarget: globalRanking[i].userId === targetUserId,
                });
            }
        }

        // Rola TOP (wymaga member fetch)
        let topRoleName = null;
        if (guild && guildConfig?.topRoles) {
            try {
                const member = await guild.members.fetch(targetUserId).catch(() => null);
                if (member) topRoleName = this._roleService.getUserTopRole(member, guildConfig.topRoles);
            } catch { /* pomiń */ }
        }

        // Pozycje w rankingach ról
        const rolePositions = [];
        if (guild && this._roleRankingCfg) {
            try {
                const roleRankings = await this._roleRankingCfg.loadRoleRankings(guildId);
                for (const rr of roleRankings) {
                    const rolePlayers = await this._rankingService
                        .getSortedPlayersByRole(guildId, rr.roleId, guild, this._roleRankingCfg)
                        .catch(() => []);
                    const roleIdx = rolePlayers.findIndex(p => p.userId === targetUserId);
                    if (roleIdx !== -1) {
                        rolePositions.push({
                            roleName: rr.roleName,
                            position: roleIdx + 1,
                            total: rolePlayers.length,
                        });
                    }
                }
            } catch { /* pomiń */ }
        }

        const username = serverRecord?.username || globalRecord?.username || targetUserId;
        const knownBossNames = Array.isArray(knownBossNamesRaw) ? [...knownBossNamesRaw].sort() : [];

        // Nazwa serwera skąd pochodzi globalny wynik gracza
        const globalSourceGuildId = globalRecord?.sourceGuildId || guildId;
        const globalGuildName = client.guilds.cache.get(globalSourceGuildId)?.name || guild?.name || guildId;

        // Tagi serwerów do wyświetlania w snippecie globalnym
        const allGuildsConfig = this._guildConfigService?.getAllConfiguredGuilds() || [];
        const guildTags = Object.fromEntries(
            allGuildsConfig.filter(g => g.tag).map(g => [g.id, g.tag])
        );

        return {
            guildId,
            guildName: guild?.name || guildId,
            globalGuildName,
            guildTags,
            targetUserId,
            username,
            serverRecord,
            serverPosition,
            serverTotal: sortedPlayers.length,
            globalRecord,
            globalPosition,
            globalTotal: globalRanking.length,
            snippetPlayers,
            topRoleName,
            rolePositions,
            allBossRecords,
            bossGlobalPositions,
            knownBossNames,
        };
    }

    /**
     * Buduje główny embed profilu.
     */
    buildMainEmbed(data, isPol) {
        const t = (pol, eng) => isPol ? pol : eng;
        const {
            username, globalGuildName, guildTags,
            serverRecord, serverPosition, serverTotal,
            globalPosition, globalTotal, topRoleName, rolePositions, snippetPlayers,
        } = data;

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`👤 ${username} — ${globalGuildName}`);

        const roleValue = rolePositions.length > 0
            ? rolePositions.map(r => `${r.roleName}: **#${r.position}** / ${r.total}`).join('\n')
            : '—';

        const rec = serverRecord || data.globalRecord;
        const scoreValue = rec
            ? (() => {
                const date = new Date(rec.timestamp).toLocaleString(
                    isPol ? 'pl-PL' : 'en-GB',
                    { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
                );
                const boss = rec.bossName ? ` — ${rec.bossName}` : '';
                return `**${rec.score}**${boss}\n📅 ${date}`;
            })()
            : '—';

        // Wszystkie pola jedno pod drugim
        embed.addFields(
            { name: t('👑 Rola TOP',               '👑 TOP Role'),           value: topRoleName || '—',                                                                inline: false },
            { name: t('🏰 Pozycja na serwerze',    '🏰 Server Position'),    value: serverPosition !== null ? `**#${serverPosition}** / ${serverTotal}` : '—',         inline: false },
            { name: t('🏅 Rankingi Ról',           '🏅 Role Rankings'),      value: roleValue,                                                                          inline: false },
            { name: t('📊 Najlepszy Wynik',         '📊 Best Score'),         value: scoreValue,                                                                         inline: false },
            { name: t('🌐 Pozycja Globalna',        '🌐 Global Position'),    value: globalPosition !== null ? `**#${globalPosition}** / ${globalTotal}` : '—',         inline: false }
        );

        if (snippetPlayers.length > 0) {
            const lines = snippetPlayers.map(p => {
                const medal = p.position === 1 ? '🥇' : p.position === 2 ? '🥈' : p.position === 3 ? '🥉' : '';
                const posStr = medal ? `${medal} \`#${p.position}\`` : `\`#${p.position}\``;
                const nameStr = p.isTarget ? `**__${p.username}__**` : `**${p.username}**`;
                const tag = guildTags?.[p.sourceGuildId] ? ` · ${guildTags[p.sourceGuildId]}` : '';
                return `${posStr} ${nameStr} · ${p.score}${tag}`;
            });
            embed.addFields({ name: t('🌐 Globalny Ranking', '🌐 Global Ranking'), value: lines.join('\n'), inline: false });
        }

        return embed;
    }

    /**
     * Buduje embed bossów (wszyscy znani bossowie z rekordami gracza).
     * @returns {{ embed: EmbedBuilder, totalPages: number, currentPage: number }}
     */
    buildBossesEmbed(data, isPol, page) {
        const t = (pol, eng) => isPol ? pol : eng;
        const { username, knownBossNames, allBossRecords, bossGlobalPositions } = data;

        // Rozdziel na: z rekordem (wg scoreValue malejąco) i bez rekordu (alfabetycznie)
        const withRecord = knownBossNames
            .filter(b => allBossRecords[b])
            .sort((a, b) => (allBossRecords[b].scoreValue || 0) - (allBossRecords[a].scoreValue || 0));
        const noRecord = knownBossNames.filter(b => !allBossRecords[b]);

        const sorted = [...withRecord, ...noRecord];
        const totalBosses = sorted.length;
        const totalPages  = Math.max(1, Math.ceil(totalBosses / BOSSES_PER_PAGE));
        const safePage    = Math.max(0, Math.min(page, totalPages - 1));
        const slice       = sorted.slice(safePage * BOSSES_PER_PAGE, (safePage + 1) * BOSSES_PER_PAGE);

        let description;
        if (totalBosses === 0) {
            description = t('Brak skonfigurowanych bossów.', 'No configured bosses.');
        } else {
            const lines = [];
            for (const bossName of slice) {
                const rec = allBossRecords[bossName];
                if (!rec) {
                    lines.push(`— **${bossName}**`);
                    continue;
                }
                // Numer = pozycja w posortowanej liście z rekordem (1-indexed, globalnie po stronach)
                const pos = String(withRecord.indexOf(bossName) + 1).padStart(2, '0');
                const date = new Date(rec.timestamp);
                const shortDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                const globalPos = bossGlobalPositions?.[bossName];
                const globalStr = globalPos ? `  ·  #${globalPos} ${t('globalnie', 'globally')}` : '';
                lines.push(`\`${pos}\`  **${bossName}**  ·  **${rec.score}**\n> *${shortDate}*${globalStr}`);
            }
            description = lines.join('\n\n');
        }

        const embed = new EmbedBuilder()
            .setColor(0xFF6B35)
            .setTitle(`🎯 ${t('Bossowie', 'Bosses')} — ${username}`)
            .setDescription(description)
            .setFooter({
                text: t(
                    `Strona ${safePage + 1} z ${totalPages} · ${withRecord.length} rekordów · ${totalBosses} bossów`,
                    `Page ${safePage + 1} of ${totalPages} · ${withRecord.length} records · ${totalBosses} bosses`
                ),
            });

        return { embed, totalPages, currentPage: safePage };
    }

    /**
     * Buduje komponenty (przyciski) dla profilu.
     * @param {Object} state - { view, category, bossPage, bossMaxPage, isOwnProfile }
     * @param {boolean} isPol
     * @returns {ActionRowBuilder[]}
     */
    buildProfileComponents(state, isPol) {
        const t = (pol, eng) => isPol ? pol : eng;
        const { view, category, bossPage, bossMaxPage, isOwnProfile } = state;

        const inAch = view === 'ach_overview' || view === 'ach_cat';

        // Rząd 1: zakładki główne
        const mainButtons = [
            new ButtonBuilder()
                .setCustomId('profile_main')
                .setLabel(t('Profil', 'Profile'))
                .setEmoji('👤')
                .setStyle(view === 'main' ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(view === 'main'),
            new ButtonBuilder()
                .setCustomId('profile_bosses')
                .setLabel(t('Bossowie', 'Bosses'))
                .setEmoji('🎯')
                .setStyle(view === 'bosses' ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(view === 'bosses'),
            new ButtonBuilder()
                .setCustomId('profile_ach_overview')
                .setLabel(t('Osiągnięcia', 'Achievements'))
                .setEmoji('🏆')
                .setStyle(inAch ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(inAch && view === 'ach_overview'),
            new ButtonBuilder()
                .setCustomId('profile_search')
                .setLabel(t('Szukaj gracza', 'Search Player'))
                .setEmoji('🔍')
                .setStyle(ButtonStyle.Secondary),
        ];

        if (!isOwnProfile) {
            mainButtons.push(
                new ButtonBuilder()
                    .setCustomId('profile_back')
                    .setLabel(t('Wróć do siebie', 'Back to Me'))
                    .setEmoji('◀️')
                    .setStyle(ButtonStyle.Danger)
            );
        }

        const rows = [new ActionRowBuilder().addComponents(...mainButtons)];

        // Rząd 2: 5 kategorii osiągnięć (max 5 przycisków per rząd)
        // "Podsumowanie" obsługuje przycisk "Osiągnięcia" z rzędu 1 (ten sam customId profile_ach_overview)
        if (inAch) {
            const CATS = [
                { key: 'score',    pol: 'Wyniki',      eng: 'Scores',    emoji: '🏆' },
                { key: 'records',  pol: 'Rekordy',     eng: 'Records',   emoji: '🔁' },
                { key: 'bosses',   pol: 'Łowy',        eng: 'The Hunt',  emoji: '🎯' },
                { key: 'prestige', pol: 'Prestiż',     eng: 'Prestige',  emoji: '💎' },
                { key: 'explorer', pol: 'Eksplorator', eng: 'Explorer',  emoji: '🕵️' },
            ];
            const achNavRow = new ActionRowBuilder().addComponents(
                ...CATS.map(c => new ButtonBuilder()
                    .setCustomId(`profile_ach_cat_${c.key}`)
                    .setEmoji(c.emoji)
                    .setLabel(isPol ? c.pol : c.eng)
                    .setStyle((view === 'ach_cat' && category === c.key) ? ButtonStyle.Primary : ButtonStyle.Secondary)
                    .setDisabled(view === 'ach_cat' && category === c.key)
                )
            );
            rows.push(achNavRow);
        }

        // Rząd 3: paginacja bossów
        if (view === 'bosses' && bossMaxPage > 1) {
            rows.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('profile_bosses_prev')
                    .setEmoji('◀')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(bossPage === 0),
                new ButtonBuilder()
                    .setCustomId('profile_bosses_next')
                    .setEmoji('▶')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(bossPage >= bossMaxPage - 1)
            ));
        }

        return rows;
    }
}

module.exports = ProfileService;
