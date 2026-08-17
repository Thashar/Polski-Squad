const fs = require('fs').promises;
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const { polandWallClockToUTC, getPolandParts, formatPolandDateTime } = require('../utils/timezone');
const { createBotLogger } = require('../../utils/consoleLogger');
const store = require('../../utils/jsonStore');

const logger = createBotLogger('Kontroler');

const SHARED_GLORY_PROGRESS = path.join(__dirname, '../../shared_data/glory_progress.json');
const SHARED_GLORY_WINNERS = path.join(__dirname, '../../shared_data/glory_winners.json');

// Polska odmiana słowa "los": 1 los, 2-4 losy, 5+ losów (z wyjątkami 12-14 → losów)
function losWord(n) {
    if (n === 1) return 'los';
    const d = n % 10, dd = n % 100;
    if (d >= 2 && d <= 4 && !(dd >= 12 && dd <= 14)) return 'losy';
    return 'losów';
}

/**
 * Loteria Glory — cotygodniowe losowanie (piątek 22:00 czasu polskiego) osobno dla każdego klanu.
 *
 * Źródło danych: shared_data/glory_progress.json (eksportowane przez Stalkera na podstawie
 * progresu Fazy 1). Każdy uczestnik ma przypisaną liczbę losów (1, 2, 3, … bez limitu). Losowanie jest ważone
 * (uczestnik z N losami = N wpisów w puli), bez powtórzeń zwycięzców.
 *
 * Wyniki ogłaszane na kanale klanu (env KONTROLER_GLORY_CHANNEL_*) z pingiem roli klanowej.
 * Każde zwycięstwo dopisywane do shared_data/glory_winners.json (licznik gwiazdek u Stalkera).
 */
class GloryLotteryService {
    constructor(config) {
        this.config = config;
        this.cfg = config.glory;
        this.logger = logger;
        this.client = null;
        this.drawTimer = null;
        this.historyFile = this.cfg.dataFile;
        // history[clanKey] = { drawnAt, lastWeek, participants:[{userId,displayName,tickets}], winners:[{userId,displayName}] }
        this.history = {};
    }

    async initialize(client) {
        this.client = client;
        await this.loadHistory();
        this.scheduleNextDraw();
        logger.info('✅ Glory: serwis loterii Glory zainicjalizowany');
    }

    stop() {
        if (this.drawTimer) { clearTimeout(this.drawTimer); this.drawTimer = null; }
    }

    // ===== Persistencja =====

    async loadHistory() {
        try {
            this.history = await store.getOrLoad(this.historyFile, () => ({}));
        } catch {
            this.history = {};
        }
    }

    async saveHistory() {
        try {
            await fs.mkdir(path.dirname(this.historyFile), { recursive: true });
            await store.set(this.historyFile, this.history);
        } catch (e) {
            logger.error(`❌ Glory: błąd zapisu historii: ${e.message}`);
        }
    }

    // ===== Harmonogram (piątek 22:00 czasu polskiego) =====

    getNextScheduledTime() {
        const now = new Date();
        const p = getPolandParts(now);
        const baseUTC = Date.UTC(p.year, p.month - 1, p.day);
        const currentWeekday = new Date(baseUTC).getUTCDay(); // 0=niedziela ... 6=sobota
        const daysUntil = (this.cfg.scheduleWeekday - currentWeekday + 7) % 7;

        const buildFor = (extraDays) => {
            const target = new Date(baseUTC + (daysUntil + extraDays) * 24 * 60 * 60 * 1000);
            return polandWallClockToUTC(
                target.getUTCFullYear(), target.getUTCMonth() + 1, target.getUTCDate(),
                this.cfg.scheduleHour, this.cfg.scheduleMinute
            );
        };

        let scheduled = buildFor(0);
        if (scheduled.getTime() <= now.getTime()) {
            scheduled = buildFor(7);
        }
        return scheduled;
    }

    scheduleNextDraw() {
        if (this.drawTimer) { clearTimeout(this.drawTimer); this.drawTimer = null; }
        const next = this.getNextScheduledTime();
        const delay = Math.max(0, next.getTime() - Date.now());
        this.drawTimer = setTimeout(() => this.runDraw(), delay);
        logger.info(`⏰ Glory: następne losowanie zaplanowane na ${formatPolandDateTime(next)} (za ${Math.round(delay / (60 * 60 * 1000))}h)`);
    }

    // ===== Odczyt danych progresu =====

    async readProgress() {
        try {
            const all = await store.getOrLoad(SHARED_GLORY_PROGRESS, () => ({}));
            return all[this.config.guildId] || null;
        } catch (e) {
            logger.warn(`⚠️ Glory: brak danych progresu (${SHARED_GLORY_PROGRESS}): ${e.message}`);
            return null;
        }
    }

    // ===== Losowanie ważone =====

    /**
     * Zwraca zbiór userId uczestników, którzy mają którąś z ról wykluczonych z wygrywania
     * (`config.glory.excludedRoles`). Osoby te są usuwane z puli losowania, ale nadal liczą się
     * do średniej progresu ("oczekiwany standard"), która jest liczona po stronie Stalkera.
     */
    async getExcludedUserIds(guild, participants) {
        const excluded = new Set();
        const roles = this.cfg.excludedRoles || [];
        if (!guild || roles.length === 0 || !participants || participants.length === 0) return excluded;

        // Wyjątek od wyjątku: osoby z tej listy nie są wykluczane mimo roli wykluczającej
        const exceptions = new Set(this.cfg.excludedRolesExceptions || []);

        try {
            const ids = participants.map(p => p.userId);
            const members = await guild.members.fetch({ user: ids });
            for (const [id, member] of members) {
                if (exceptions.has(id)) continue; // dopuszczony mimo roli wykluczającej
                if (roles.some(roleId => member.roles.cache.has(roleId))) excluded.add(id);
            }
        } catch (e) {
            logger.warn(`⚠️ Glory: nie udało się pobrać członków do wykluczeń ról: ${e.message}`);
        }
        return excluded;
    }

    drawWeighted(participants, count, excludeIds = new Set()) {
        const pool = [];
        for (const p of participants) {
            if (excludeIds.has(p.userId)) continue;
            const tickets = Math.max(1, Math.floor(p.tickets || 1)); // bez górnego limitu
            for (let i = 0; i < tickets; i++) pool.push(p);
        }
        // Tasowanie Fisher-Yates
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        const winners = [];
        const chosen = new Set();
        for (const p of pool) {
            if (winners.length >= count) break;
            if (chosen.has(p.userId)) continue;
            chosen.add(p.userId);
            winners.push(p);
        }
        return winners;
    }

    // ===== Losowanie cotygodniowe =====

    async runDraw() {
        try {
            logger.info('🎲 Glory: rozpoczynam cotygodniowe losowanie...');
            const data = await this.readProgress();
            if (!data || !data.clans) {
                logger.warn('⚠️ Glory: brak danych progresu — losowanie pominięte');
                return;
            }

            const guild = await this.client.guilds.fetch(this.config.guildId).catch(() => null);

            for (const [clanKey, clanCfg] of Object.entries(this.cfg.clans)) {
                const clanData = data.clans[clanKey] || {};
                const participants = clanData.participants || [];
                const channel = guild
                    ? await guild.channels.fetch(clanCfg.channelId).catch(() => null)
                    : null;

                if (participants.length === 0) {
                    await this.announceNoParticipants(channel, clanCfg);
                    this.history[clanKey] = {
                        drawnAt: new Date().toISOString(),
                        lastWeek: clanData.lastWeek || null,
                        participants: [],
                        winners: []
                    };
                    continue;
                }

                // Wyklucz z losowania osoby z ról wykluczonych (nadal liczą się do średniej w Stalkerze)
                const excludeIds = await this.getExcludedUserIds(guild, participants);
                const winners = this.drawWeighted(participants, this.cfg.winnersCount, excludeIds);
                await this.announceWinners(channel, clanCfg, winners, participants, clanData, excludeIds);
                await this.recordGloryWins(winners, clanKey, clanData.lastWeek);

                this.history[clanKey] = {
                    drawnAt: new Date().toISOString(),
                    lastWeek: clanData.lastWeek || null,
                    participants,
                    winners: winners.map(w => ({ userId: w.userId, displayName: w.displayName }))
                };
                logger.info(`🏆 Glory (${clanCfg.displayName}): wylosowano ${winners.length} z ${participants.length} uczestników`);
            }

            await this.saveHistory();
        } catch (e) {
            logger.error(`❌ Glory: błąd losowania: ${e.message}`);
            logger.error(e.stack);
        } finally {
            this.scheduleNextDraw();
        }
    }

    // ===== Reroll (system awaryjny) =====

    /**
     * Dobiera dodatkowego zwycięzcę spośród uczestników ostatniego losowania, którzy nie wygrali.
     * @returns {{success:boolean, reason?:string, winner?:Object}}
     */
    async reroll(clanKey) {
        const rec = this.history[clanKey];
        if (!rec) return { success: false, reason: 'no_draw' };
        if (!rec.participants || rec.participants.length === 0) return { success: false, reason: 'no_participants' };

        const clanCfg = this.cfg.clans[clanKey];
        const guild = await this.client.guilds.fetch(this.config.guildId).catch(() => null);

        // Wyklucz dotychczasowych zwycięzców ORAZ osoby z ról wykluczonych
        const roleExcluded = await this.getExcludedUserIds(guild, rec.participants);
        const excludeIds = new Set([...(rec.winners || []).map(w => w.userId), ...roleExcluded]);
        const remaining = rec.participants.filter(p => !excludeIds.has(p.userId));
        if (remaining.length === 0) return { success: false, reason: 'no_more' };

        const drawn = this.drawWeighted(rec.participants, 1, excludeIds);
        if (drawn.length === 0) return { success: false, reason: 'no_more' };
        const winner = drawn[0];

        rec.winners = rec.winners || [];
        rec.winners.push({ userId: winner.userId, displayName: winner.displayName });
        await this.saveHistory();

        const channel = guild ? await guild.channels.fetch(clanCfg.channelId).catch(() => null) : null;
        await this.announceReroll(channel, clanCfg, winner);
        await this.recordGloryWins([winner], clanKey, rec.lastWeek);

        return { success: true, winner };
    }

    // ===== Licznik zwycięstw Glory (gwiazdki u Stalkera) =====

    async recordGloryWins(winners, clanKey, lastWeek) {
        if (!winners || winners.length === 0) return;
        try {
            // Plik dzielony ze Stalkerem (/player-status czyta z niego liczbę Glory)
            const all = await store.getOrLoad(SHARED_GLORY_WINNERS, () => ({}));

            const wonAt = new Date().toISOString();
            for (const w of winners) {
                if (!all[w.userId]) all[w.userId] = { count: 0, displayName: w.displayName, history: [] };
                all[w.userId].count += 1;
                all[w.userId].displayName = w.displayName;
                all[w.userId].lastWonAt = wonAt;
                all[w.userId].history.push({ clan: clanKey, week: lastWeek || null, wonAt });
                if (all[w.userId].history.length > 100) {
                    all[w.userId].history = all[w.userId].history.slice(-100);
                }
            }

            await fs.mkdir(path.dirname(SHARED_GLORY_WINNERS), { recursive: true });
            await store.set(SHARED_GLORY_WINNERS, all);
        } catch (e) {
            logger.error(`❌ Glory: błąd zapisu licznika zwycięstw: ${e.message}`);
        }
    }

    // ===== Test: realne losowanie publikowane na docelowym kanale (bez zapisu do statystyk) =====

    /**
     * Wykonuje testowe losowanie dla wybranego klanu (lub wszystkich) i PUBLIKUJE wynik
     * na docelowym kanale klanu (embed zwycięzców + PEŁNA lista uczestników). Oznaczone jako test.
     * NIE zapisuje zwycięstw do glory_winners.json, NIE zapisuje historii, NIE pinguje roli.
     * @param {string|null} onlyClanKey - klucz klanu ('0'/'1'/'2'/'main') lub null = wszystkie
     */
    async runTestDraw(onlyClanKey = null) {
        const data = await this.readProgress();
        if (!data || !data.clans) return { hasData: false, results: [] };

        const guild = await this.client.guilds.fetch(this.config.guildId).catch(() => null);
        const clanEntries = Object.entries(this.cfg.clans)
            .filter(([key]) => !onlyClanKey || key === onlyClanKey);

        const results = [];
        for (const [clanKey, clanCfg] of clanEntries) {
            const clanData = data.clans[clanKey] || {};
            const participants = clanData.participants || [];
            const channel = guild
                ? await guild.channels.fetch(clanCfg.channelId).catch(() => null)
                : null;

            if (!channel) {
                results.push({ clanKey, clanCfg, participants, winners: [], sent: false, reason: 'no_channel' });
                continue;
            }

            if (participants.length === 0) {
                const embed = this._prependTestBanner(this.buildNoParticipantsEmbed(clanCfg));
                await channel.send({ embeds: [embed] });
                results.push({ clanKey, clanCfg, participants, winners: [], sent: true });
                continue;
            }

            const excludeIds = await this.getExcludedUserIds(guild, participants);
            const winners = this.drawWeighted(participants, this.cfg.winnersCount, excludeIds);
            await this.publishTestAnnouncement(channel, clanCfg, winners, participants, clanData, excludeIds);
            results.push({ clanKey, clanCfg, participants, winners, excludedCount: excludeIds.size, sent: true });
        }

        return { hasData: true, results };
    }

    /**
     * Dopisuje na górze opisu embeda baner informujący, że to losowanie testowe.
     */
    _prependTestBanner(embed) {
        const banner = '> 🧪 **LOSOWANIE TESTOWE** — to nie jest oficjalne cykliczne losowanie\n\n';
        return embed.setDescription(banner + (embed.data.description || ''));
    }

    /**
     * Publikuje na kanale wynik wyglądający jak prawdziwe cykliczne losowanie:
     * ping roli klanowej + embed zwycięzców (z banerem testowym na górze) + PEŁNA lista uczestników.
     */
    async publishTestAnnouncement(channel, clanCfg, winners, participants, clanData, excludeIds = new Set()) {
        // Nicki serwerowe dla wszystkich uczestników (obejmuje też zwycięzców)
        const nameMap = await this.resolveDisplayNames(channel.guild, participants.map(p => p.userId));
        const embed = this.buildResultEmbed(clanCfg, winners, participants, clanData, excludeIds, nameMap, true);
        // Jak realne losowanie — ping roli klanowej + JEDEN embed (zwycięzcy + lista uczestników)
        await channel.send({
            content: `<@&${clanCfg.roleId}>`,
            embeds: [embed],
            allowedMentions: { roles: [clanCfg.roleId] }
        });
    }

    /**
     * Buduje mapę userId → nick serwerowy dla podanych ID.
     * Wzmianki `<@id>` w opisie embeda Discord renderuje jako nick tylko gdy użytkownik jest w cache
     * klienta — inaczej pokazuje surowe ID. Dlatego w embedach wyświetlamy nick jako zwykły tekst.
     */
    async resolveDisplayNames(guild, ids) {
        const map = new Map();
        if (!guild || !ids || ids.length === 0) return map;
        try {
            const members = await guild.members.fetch({ user: ids });
            for (const [id, member] of members) map.set(id, member.displayName);
        } catch (e) {
            logger.warn(`⚠️ Glory: nie udało się pobrać nicków serwerowych: ${e.message}`);
        }
        return map;
    }

    /** Nick do wyświetlenia: aktualny nick serwerowy → zapisany displayName → ID jako ostateczność. */
    _name(userId, storedName, nameMap) {
        return (nameMap && nameMap.get(userId)) || storedName || `Gracz ${userId}`;
    }

    /**
     * Buduje JEDEN embed z wynikami losowania: zwycięzcy + standard tygodnia + PEŁNA lista uczestników.
     * Osoby wykluczone (excludeIds) mają skrócony wpis 🚫 (ich losy nie liczą się do puli).
     * Lista uczestników jest przycinana, by cały opis zmieścił się w limicie 4096 znaków Discorda.
     * @param {boolean} isTest - gdy true, na górze dodawany jest baner LOSOWANIE TESTOWE
     */
    buildResultEmbed(clanCfg, winners, participants, clanData, excludeIds = new Set(), nameMap = null, isTest = false) {
        const weekLabel = clanData.lastWeek
            ? `${clanData.lastWeek.weekNumber}/${clanData.lastWeek.year}`
            : '—';

        const winnersList = winners.length > 0
            ? winners
                .map((w, i) => `**${i + 1}.** ${this._name(w.userId, w.displayName, nameMap)} — progres **${w.progress}** (${w.tickets} ${losWord(w.tickets)})`)
                .join('\n')
            : '*Brak zwycięzców — wszyscy uczestnicy są wykluczeni z losowania.*';

        // Standard tygodnia (średni progres) + konkretne progi losów dla tego klanu
        const avg = clanData.averageProgress;
        const standardLine = (avg && avg > 0)
            ? `📊 **Standard tygodnia** (średni progres progresujących): **${avg}**
🎟️ Progi losów: ≥5 → **1**, ≥${avg} → **2**, ≥${Math.round(2 * avg)} → **3**, ≥${Math.round(3 * avg)} → **4**, … (bez limitu)`
            : '📊 **Standard tygodnia:** brak danych z poprzedniego tygodnia — każdy uczestnik dostaje 1 los';

        // Pełna lista uczestników (posortowana wg losów, potem progresu)
        const winnerIds = new Set(winners.map(w => w.userId));
        const sorted = [...participants].sort((a, b) => (b.tickets - a.tickets) || (b.progress - a.progress));
        const partLines = sorted.map((p, i) => {
            const name = this._name(p.userId, p.displayName, nameMap);
            if (excludeIds.has(p.userId)) return `🚫 ${name} — wykluczony z losowania`;
            const marker = winnerIds.has(p.userId) ? '🏆' : `**${i + 1}.**`;
            return `${marker} ${name} — progres **${p.progress}** → **${p.tickets}** ${losWord(p.tickets)}`;
        });
        const totalTickets = participants.reduce((s, p) => s + (excludeIds.has(p.userId) ? 0 : (p.tickets || 1)), 0);
        const excludedNote = excludeIds.size > 0 ? ` · 🚫 wykluczonych: **${excludeIds.size}**` : '';

        const banner = isTest ? '> 🧪 **LOSOWANIE TESTOWE** — to nie jest oficjalne cykliczne losowanie\n\n' : '';
        const head = `${banner}# 🏆 Loteria Glory — ${clanCfg.displayName}

Zwycięzcy losowania **rangi Glory Member** za progres w Fazie 1 (tydzień ${weekLabel}):

${winnersList}

${standardLine}

**🎟️ Uczestnicy losowania** (${participants.length}, pula losów: ${totalTickets}${excludedNote}):
`;
        const footer = '\n-# Losowanie ważone progresem (więcej progresu = więcej losów)';

        // Zmieść listę uczestników w limicie 4096 znaków opisu embeda
        const budget = 4096 - head.length - footer.length - 60;
        let body = '';
        let shown = 0;
        for (const line of partLines) {
            if ((body + '\n' + line).length > budget) break;
            body += (body ? '\n' : '') + line;
            shown++;
        }
        if (shown < partLines.length) body += `\n-# …i ${partLines.length - shown} więcej`;

        return new EmbedBuilder()
            .setDescription(head + body + footer)
            .setColor(0xF1C40F)
            .setTimestamp();
    }

    buildNoParticipantsEmbed(clanCfg) {
        return new EmbedBuilder()
            .setDescription(`# 🏆 Loteria Glory — ${clanCfg.displayName}

W tym tygodniu nikt nie zaliczył wystarczającego progresu w Fazie 1 — brak zwycięzców.`)
            .setColor(0x95A5A6)
            .setTimestamp();
    }

    async announceWinners(channel, clanCfg, winners, participants, clanData, excludeIds = new Set()) {
        if (!channel) {
            logger.warn(`⚠️ Glory: brak kanału ogłoszeń dla ${clanCfg.displayName} (${clanCfg.channelId})`);
            return;
        }
        // Nicki serwerowe dla wszystkich uczestników (obejmuje też zwycięzców)
        const nameMap = await this.resolveDisplayNames(channel.guild, participants.map(p => p.userId));
        const embed = this.buildResultEmbed(clanCfg, winners, participants, clanData, excludeIds, nameMap, false);
        await channel.send({
            content: `<@&${clanCfg.roleId}>`,
            embeds: [embed],
            allowedMentions: { roles: [clanCfg.roleId] }
        });
    }

    async announceReroll(channel, clanCfg, winner) {
        if (!channel) return;
        const nameMap = await this.resolveDisplayNames(channel.guild, [winner.userId]);
        const embed = new EmbedBuilder()
            .setDescription(`# 🎲 Dodatkowy zwycięzca Glory — ${clanCfg.displayName}

Dodatkowo wylosowano: ${this._name(winner.userId, winner.displayName, nameMap)} — progres **${winner.progress}** (${winner.tickets} ${losWord(winner.tickets)})`)
            .setColor(0xF1C40F)
            .setTimestamp();

        await channel.send({
            content: `<@&${clanCfg.roleId}>`,
            embeds: [embed],
            allowedMentions: { roles: [clanCfg.roleId] }
        });
    }

    async announceNoParticipants(channel, clanCfg) {
        if (!channel) return;
        await channel.send({ embeds: [this.buildNoParticipantsEmbed(clanCfg)] });
    }
}

module.exports = GloryLotteryService;
