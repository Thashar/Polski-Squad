const fs = require('fs').promises;
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const { polandWallClockToUTC, getPolandParts, formatPolandDateTime } = require('../utils/timezone');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Kontroler');

const SHARED_GLORY_PROGRESS = path.join(__dirname, '../../shared_data/glory_progress.json');
const SHARED_GLORY_WINNERS = path.join(__dirname, '../../shared_data/glory_winners.json');

/**
 * Loteria Glory — cotygodniowe losowanie (piątek 22:00 czasu polskiego) osobno dla każdego klanu.
 *
 * Źródło danych: shared_data/glory_progress.json (eksportowane przez Stalkera na podstawie
 * progresu Fazy 1). Każdy uczestnik ma przypisaną liczbę losów (1/2/3). Losowanie jest ważone
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
            const raw = await fs.readFile(this.historyFile, 'utf8');
            this.history = JSON.parse(raw) || {};
        } catch {
            this.history = {};
        }
    }

    async saveHistory() {
        try {
            await fs.mkdir(path.dirname(this.historyFile), { recursive: true });
            await fs.writeFile(this.historyFile, JSON.stringify(this.history, null, 2), 'utf8');
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
            const raw = await fs.readFile(SHARED_GLORY_PROGRESS, 'utf8');
            const all = JSON.parse(raw);
            return all[this.config.guildId] || null;
        } catch (e) {
            logger.warn(`⚠️ Glory: brak danych progresu (${SHARED_GLORY_PROGRESS}): ${e.message}`);
            return null;
        }
    }

    // ===== Losowanie ważone =====

    drawWeighted(participants, count, excludeIds = new Set()) {
        const pool = [];
        for (const p of participants) {
            if (excludeIds.has(p.userId)) continue;
            const tickets = Math.max(1, Math.min(3, p.tickets || 1));
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

                const winners = this.drawWeighted(participants, this.cfg.winnersCount);
                await this.announceWinners(channel, clanCfg, winners, participants, clanData);
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

        const excludeIds = new Set((rec.winners || []).map(w => w.userId));
        const remaining = rec.participants.filter(p => !excludeIds.has(p.userId));
        if (remaining.length === 0) return { success: false, reason: 'no_more' };

        const drawn = this.drawWeighted(rec.participants, 1, excludeIds);
        if (drawn.length === 0) return { success: false, reason: 'no_more' };
        const winner = drawn[0];

        rec.winners = rec.winners || [];
        rec.winners.push({ userId: winner.userId, displayName: winner.displayName });
        await this.saveHistory();

        const clanCfg = this.cfg.clans[clanKey];
        const guild = await this.client.guilds.fetch(this.config.guildId).catch(() => null);
        const channel = guild ? await guild.channels.fetch(clanCfg.channelId).catch(() => null) : null;
        await this.announceReroll(channel, clanCfg, winner);
        await this.recordGloryWins([winner], clanKey, rec.lastWeek);

        return { success: true, winner };
    }

    // ===== Licznik zwycięstw Glory (gwiazdki u Stalkera) =====

    async recordGloryWins(winners, clanKey, lastWeek) {
        if (!winners || winners.length === 0) return;
        try {
            let all = {};
            try {
                const raw = await fs.readFile(SHARED_GLORY_WINNERS, 'utf8');
                all = JSON.parse(raw) || {};
            } catch { /* plik nie istnieje */ }

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
            await fs.writeFile(SHARED_GLORY_WINNERS, JSON.stringify(all, null, 2), 'utf8');
        } catch (e) {
            logger.error(`❌ Glory: błąd zapisu licznika zwycięstw: ${e.message}`);
        }
    }

    // ===== Ogłoszenia =====

    async announceWinners(channel, clanCfg, winners, participants, clanData) {
        if (!channel) {
            logger.warn(`⚠️ Glory: brak kanału ogłoszeń dla ${clanCfg.displayName} (${clanCfg.channelId})`);
            return;
        }
        const weekLabel = clanData.lastWeek
            ? `${clanData.lastWeek.weekNumber}/${clanData.lastWeek.year}`
            : '—';

        const winnersList = winners
            .map((w, i) => `**${i + 1}.** <@${w.userId}> — progres **${w.progress}** (${w.tickets} ${w.tickets === 1 ? 'los' : 'losy'})`)
            .join('\n');

        const embed = new EmbedBuilder()
            .setDescription(`# 🏆 Loteria Glory — ${clanCfg.displayName}

Zwycięzcy losowania **rangi Glory Member** za progres w Fazie 1 (tydzień ${weekLabel}):

${winnersList}

-# 🎟️ Uczestników: ${participants.length} · Losowanie ważone progresem (1–3 losy)`)
            .setColor(0xF1C40F)
            .setTimestamp();

        await channel.send({
            content: `<@&${clanCfg.roleId}>`,
            embeds: [embed],
            allowedMentions: { roles: [clanCfg.roleId], users: winners.map(w => w.userId) }
        });
    }

    async announceReroll(channel, clanCfg, winner) {
        if (!channel) return;
        const embed = new EmbedBuilder()
            .setDescription(`# 🎲 Dodatkowy zwycięzca Glory — ${clanCfg.displayName}

Dodatkowo wylosowano: <@${winner.userId}> — progres **${winner.progress}** (${winner.tickets} ${winner.tickets === 1 ? 'los' : 'losy'})`)
            .setColor(0xF1C40F)
            .setTimestamp();

        await channel.send({
            content: `<@&${clanCfg.roleId}>`,
            embeds: [embed],
            allowedMentions: { roles: [clanCfg.roleId], users: [winner.userId] }
        });
    }

    async announceNoParticipants(channel, clanCfg) {
        if (!channel) return;
        const embed = new EmbedBuilder()
            .setDescription(`# 🏆 Loteria Glory — ${clanCfg.displayName}

W tym tygodniu nikt nie zaliczył wystarczającego progresu w Fazie 1 — brak zwycięzców.`)
            .setColor(0x95A5A6)
            .setTimestamp();
        await channel.send({ embeds: [embed] });
    }
}

module.exports = GloryLotteryService;
