const { ChannelType, PermissionsBitField, EmbedBuilder } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');
const NicknameManager = require('../../utils/nicknameManagerService');
const { polandWallClockToUTC, getPolandParts, formatPolandDateTime } = require('../utils/timezone');

/**
 * System MVP tygodnia — nagradza autora najzabawniejszego tekstu (najwięcej reakcji KEKW).
 *
 * Cykl (czas polski Europe/Warsaw):
 *  - czwartek 21:30 → skan wszystkich kanałów (poza wykluczonymi) 7 dni wstecz,
 *    wybór TOP kandydatów wg liczby reakcji KEKW, post z ankietą reakcyjną (@everyone, 24h),
 *  - piątek 21:30 → zamknięcie ankiety, ogłoszenie zwycięzcy (@everyone),
 *    zdjęcie roli MVP wszystkim i nadanie jej zwycięzcy na kolejny tydzień.
 *
 * Głosowanie reakcjami: 1 głos na osobę (kliknięcie innej reakcji kasuje poprzednią).
 * Wszystko jest restart-safe (persystencja w plikach JSON + odtwarzanie timerów).
 */
class MvpService {
    constructor(config) {
        this.config = config;
        this.cfg = config.mvp;
        this.logger = createBotLogger('Kontroler');

        this.dataDir = path.join(__dirname, '../data');
        this.stateFile = path.join(this.dataDir, 'mvp_state.json');
        this.winnersFile = path.join(this.dataDir, 'mvp_winners.json');
        this.approvalsFile = path.join(this.dataDir, 'mvp_approvals.json');

        this.state = this.emptyState();
        this.winners = {};
        this.currentWinnerId = null;
        // dedup aprobat MVP: messages[messageId] = { mvpUserId, authorId, effect, at }
        // wildcards: lista "dzikich kart" (z jackpota) oczekujących na najbliższą ankietę MVP
        this.approvals = { messages: {}, wildcards: [] };
        this.nicknameManager = null;

        this.finishTimer = null;
        this.scanTimer = null;
    }

    emptyState() {
        return {
            phase: 'idle',
            pollMessageId: null,
            channelId: null,
            candidates: [],
            votes: {}, // userId -> optionIndex
            postedAt: null,
            votingEndsAt: null
        };
    }

    // ===== Inicjalizacja / persystencja =====

    async initialize(client) {
        this.client = client;
        await this.ensureDataDir();
        await this.loadState();
        await this.loadWinners();
        await this.loadApprovals();
        await this.restore();
        await this.initNicknameManager(client);
    }

    /**
     * Inicjalizuje współdzielony NicknameManager (singleton) na potrzeby efektu "korona w nicku".
     * Boty działają w jednym procesie, więc singleton jest wspólny — inicjalizacja jest idempotentna.
     * Gdy się nie powiedzie, efekt korony jest pomijany (pozostałe efekty aprobaty działają normalnie).
     */
    async initNicknameManager(client) {
        try {
            this.nicknameManager = NicknameManager.getInstance();
            await this.nicknameManager.initialize();
            await this.nicknameManager.restoreExpiredEffects(client);
        } catch (error) {
            this.logger.warn(`⚠️ MVP: NicknameManager niedostępny (korona w nicku wyłączona): ${error.message}`);
            this.nicknameManager = null;
        }
    }

    async ensureDataDir() {
        try {
            await fs.mkdir(this.dataDir, { recursive: true });
        } catch (error) {
            this.logger.error(`❌ MVP: błąd tworzenia katalogu danych: ${error.message}`);
        }
    }

    async loadState() {
        try {
            const data = await fs.readFile(this.stateFile, 'utf8');
            this.state = { ...this.emptyState(), ...JSON.parse(data) };
        } catch (error) {
            if (error.code !== 'ENOENT') {
                this.logger.error(`❌ MVP: błąd ładowania stanu: ${error.message}`);
            }
            this.state = this.emptyState();
        }
    }

    async saveState() {
        try {
            await fs.writeFile(this.stateFile, JSON.stringify(this.state, null, 2));
        } catch (error) {
            this.logger.error(`❌ MVP: błąd zapisu stanu: ${error.message}`);
        }
    }

    async loadWinners() {
        try {
            const data = await fs.readFile(this.winnersFile, 'utf8');
            const parsed = JSON.parse(data);
            this.winners = parsed.winners || {};
            this.currentWinnerId = parsed.currentWinnerId || null;
        } catch (error) {
            if (error.code !== 'ENOENT') {
                this.logger.error(`❌ MVP: błąd ładowania zwycięzców: ${error.message}`);
            }
            this.winners = {};
            this.currentWinnerId = null;
        }
    }

    async saveWinners() {
        try {
            await fs.writeFile(this.winnersFile, JSON.stringify({
                winners: this.winners,
                currentWinnerId: this.currentWinnerId
            }, null, 2));
        } catch (error) {
            this.logger.error(`❌ MVP: błąd zapisu zwycięzców: ${error.message}`);
        }
    }

    async loadApprovals() {
        try {
            const data = await fs.readFile(this.approvalsFile, 'utf8');
            const parsed = JSON.parse(data);
            this.approvals = { messages: parsed.messages || {}, wildcards: parsed.wildcards || [] };
        } catch (error) {
            if (error.code !== 'ENOENT') {
                this.logger.error(`❌ MVP: błąd ładowania aprobat: ${error.message}`);
            }
            this.approvals = { messages: {}, wildcards: [] };
        }
    }

    async saveApprovals() {
        try {
            await fs.writeFile(this.approvalsFile, JSON.stringify(this.approvals, null, 2));
        } catch (error) {
            this.logger.error(`❌ MVP: błąd zapisu aprobat: ${error.message}`);
        }
    }

    /**
     * Odtwarza stan po restarcie bota: przywraca timer aktywnej ankiety i planuje kolejny skan.
     */
    async restore() {
        if (this.state.phase === 'voting' && this.state.votingEndsAt) {
            const remaining = this.state.votingEndsAt - Date.now();
            if (remaining <= 0) {
                this.logger.info('🔄 MVP: ankieta wygasła podczas przestoju - finalizuję');
                await this.finishVoting();
            } else {
                this.setFinishTimer(remaining);
                this.logger.info(`🔄 MVP: przywrócono ankietę (koniec za ${Math.round(remaining / (60 * 1000))} min)`);
                this.resyncVotes().catch(() => {});
            }
        }
        this.scheduleNextScan();
    }

    // ===== Harmonogram =====

    /**
     * Zwraca najbliższy moment (UTC Date) zaplanowanego skanu w czasie polskim.
     */
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

    scheduleNextScan() {
        if (this.scanTimer) { clearTimeout(this.scanTimer); this.scanTimer = null; }
        const next = this.getNextScheduledTime();
        const delay = Math.max(0, next.getTime() - Date.now());
        this.scanTimer = setTimeout(() => this.runWeeklyScan(), delay);
        this.logger.info(`⏰ MVP: następny skan zaplanowany na ${formatPolandDateTime(next)} (za ${Math.round(delay / (60 * 60 * 1000))}h)`);
    }

    setFinishTimer(ms) {
        this.clearFinishTimer();
        this.finishTimer = setTimeout(() => this.finishVoting(), ms);
    }

    clearFinishTimer() {
        if (this.finishTimer) { clearTimeout(this.finishTimer); this.finishTimer = null; }
    }

    stop() {
        this.clearFinishTimer();
        if (this.scanTimer) { clearTimeout(this.scanTimer); this.scanTimer = null; }
    }

    // ===== Cotygodniowy skan =====

    async runWeeklyScan() {
        try {
            if (this.state.phase === 'voting') {
                this.logger.warn('⚠️ MVP: poprzednia ankieta wciąż aktywna - pomijam nowy skan');
                return;
            }

            const windowStart = Date.now() - this.cfg.scanDays * 24 * 60 * 60 * 1000;
            this.logger.info('🔎 MVP: rozpoczynam cotygodniowy skan reakcji KEKW...');
            const candidates = await this.scanForCandidates(windowStart);

            const channel = await this.client.channels.fetch(this.cfg.pollChannelId);

            if (candidates.length === 0) {
                await channel.send({
                    content: this.buildNoCandidatesMessage(),
                    allowedMentions: { parse: ['everyone'] }
                });
                this.logger.info('📭 MVP: brak kandydatów w tym tygodniu - ogłoszono brak');
                return;
            }

            await this.startPoll(channel, candidates);
            // Dzikie karty zostały wystawione w ankiecie — czyścimy, by nie przeszły na kolejny tydzień
            await this.consumeWildcards();
        } catch (error) {
            this.logger.error(`❌ MVP: błąd cotygodniowego skanu: ${error.message}`);
        } finally {
            this.scheduleNextScan();
        }
    }

    /**
     * Skanuje wszystkie kanały tekstowe (poza wykluczonymi) i zwraca TOP kandydatów wg KEKW.
     */
    async scanForCandidates(windowStart) {
        const guild = await this.getGuild();
        const excluded = new Set([...(this.cfg.excludedChannels || []), this.cfg.pollChannelId]);
        const me = guild.members.me || await guild.members.fetchMe().catch(() => null);

        const channels = guild.channels.cache.filter(ch =>
            (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement) &&
            !excluded.has(ch.id)
        );

        const candidates = [];
        for (const channel of channels.values()) {
            try {
                if (me) {
                    const perms = channel.permissionsFor(me);
                    if (!perms || !perms.has(PermissionsBitField.Flags.ViewChannel) || !perms.has(PermissionsBitField.Flags.ReadMessageHistory)) {
                        continue;
                    }
                }
                await this.collectFromChannel(channel, windowStart, candidates);
            } catch (error) {
                this.logger.warn(`⚠️ MVP: pominięto kanał ${channel.id}: ${error.message}`);
            }
        }

        const selected = this.selectCandidates(candidates);
        const withWildcards = this.mergeWildcards(selected, windowStart);
        const wildcardCount = withWildcards.length - selected.length;
        this.logger.info(`🔎 MVP: znaleziono ${candidates.length} wiadomości z KEKW; w zestawieniu ${withWildcards.length} tekstów${wildcardCount > 0 ? ` (w tym ${wildcardCount} 🃏 dzika karta)` : ''}`);
        return withWildcards;
    }

    /**
     * Wybiera teksty do zestawienia.
     * - 1 (najlepszy) tekst na osobę,
     * - ranking osób wg liczby KEKW; bazowo `targetAuthors` osób, ale przy remisie na granicy
     *   wchodzą wszyscy remisujący (np. 5/4/3/3 → 4 osoby),
     * - najlepszy tekst danej osoby: najwięcej KEKW → remis: najwięcej pozostałych reakcji → remis: wcześniejszy.
     */
    selectCandidates(messages) {
        if (messages.length === 0) return [];

        // Komparator "lepsza wiadomość" (sort rosnący: lepsza = wcześniej):
        // KEKW ↓, pozostałe reakcje ↓, wcześniejszy timestamp ↑
        const better = (a, b) =>
            b.kekwCount - a.kekwCount ||
            b.otherReactionsCount - a.otherReactionsCount ||
            a.createdTimestamp - b.createdTimestamp;

        // Najlepszy tekst per autor
        const bestByAuthor = new Map();
        for (const msg of messages) {
            const current = bestByAuthor.get(msg.authorId);
            if (!current || better(msg, current) < 0) {
                bestByAuthor.set(msg.authorId, msg);
            }
        }

        const authors = Array.from(bestByAuthor.values()).sort(better);

        // Dobór osób: bazowo targetAuthors, ale z uwzględnieniem remisów na granicy (wg KEKW)
        let selected;
        if (authors.length <= this.cfg.targetAuthors) {
            selected = authors;
        } else {
            const cutoffKekw = authors[this.cfg.targetAuthors - 1].kekwCount;
            selected = authors.filter(a => a.kekwCount >= cutoffKekw);
        }

        // Twardy limit = liczba dostępnych emoji do głosowania
        if (selected.length > this.cfg.maxCandidates) {
            this.logger.warn(`⚠️ MVP: ${selected.length} kandydatów po remisach - przycinam do ${this.cfg.maxCandidates}`);
            selected = selected.slice(0, this.cfg.maxCandidates);
        }
        return selected;
    }

    async collectFromChannel(channel, windowStart, candidates) {
        let before;
        let safety = 0;
        while (safety < 300) {
            safety++;
            const options = { limit: 100 };
            if (before) options.before = before;
            const batch = await channel.messages.fetch(options);
            if (batch.size === 0) break;

            for (const msg of batch.values()) {
                if (msg.createdTimestamp < windowStart) continue;
                if (msg.author?.bot) continue;
                const reaction = msg.reactions.cache.find(r => r.emoji?.id === this.cfg.kekwEmojiId);
                if (!reaction) continue;
                const count = reaction.count || 0;
                if (count <= 0) continue;
                // Suma pozostałych reakcji (poza KEKW) - tie-break przy wyborze tekstu danej osoby
                let otherReactionsCount = 0;
                for (const r of msg.reactions.cache.values()) {
                    if (r.emoji?.id === this.cfg.kekwEmojiId) continue;
                    otherReactionsCount += r.count || 0;
                }
                // Jeśli wiadomość jest odpowiedzią na inną - zapamiętaj treść i autora oryginału
                let replyTo = null;
                if (msg.reference && msg.reference.messageId) {
                    try {
                        const ref = await msg.fetchReference();
                        if (ref) {
                            replyTo = {
                                authorId: ref.author?.id || null,
                                authorDisplay: ref.member?.displayName || ref.author?.username || 'nieznany',
                                content: ref.content || '',
                                hasAttachment: (ref.attachments?.size || 0) > 0
                            };
                        }
                    } catch (e) {
                        // Oryginalna wiadomość mogła zostać usunięta lub jest niedostępna - pomijamy kontekst odpowiedzi
                    }
                }
                candidates.push({
                    messageId: msg.id,
                    channelId: channel.id,
                    authorId: msg.author.id,
                    authorTag: msg.author.tag,
                    authorDisplay: msg.member?.displayName || msg.author.username,
                    content: msg.content || '',
                    hasAttachment: msg.attachments.size > 0,
                    kekwCount: count,
                    otherReactionsCount,
                    createdTimestamp: msg.createdTimestamp,
                    url: msg.url,
                    replyTo
                });
            }

            const oldest = batch.last();
            before = oldest?.id;
            if (!oldest || oldest.createdTimestamp < windowStart || batch.size < 100) break;
        }
    }

    // ===== Ankieta =====

    async startPoll(channel, candidates) {
        const pollMessage = await channel.send({
            content: this.buildPollMessage(candidates),
            allowedMentions: { parse: ['everyone'] }
        });

        for (let i = 0; i < candidates.length; i++) {
            try {
                await pollMessage.react(this.cfg.voteEmojis[i]);
            } catch (error) {
                this.logger.warn(`⚠️ MVP: nie dodano reakcji ${this.cfg.voteEmojis[i]}: ${error.message}`);
            }
        }

        const now = Date.now();
        this.state = {
            phase: 'voting',
            pollMessageId: pollMessage.id,
            channelId: channel.id,
            candidates,
            votes: {},
            postedAt: now,
            votingEndsAt: now + this.cfg.votingDurationMs
        };
        await this.saveState();
        this.setFinishTimer(this.cfg.votingDurationMs);
        this.logger.info(`🏆 MVP: rozpoczęto ankietę (${candidates.length} kandydatów), koniec za 24h`);
    }

    formatCandidateText(c) {
        let t = (c.content || '').replace(/\r?\n+/g, ' ').trim();
        if (t.length > 280) t = t.slice(0, 277) + '...';
        if (!t) t = c.hasAttachment ? '[załącznik / obraz]' : '[brak treści tekstowej]';
        return t;
    }

    formatReplyText(replyTo) {
        let t = (replyTo?.content || '').replace(/\r?\n+/g, ' ').trim();
        if (t.length > 180) t = t.slice(0, 177) + '...';
        if (!t) t = replyTo?.hasAttachment ? '[załącznik / obraz]' : '[brak treści tekstowej]';
        return t;
    }

    // Linia kontekstu: gdy tekst był odpowiedzią na inną wiadomość, pokaż na co odpowiadał
    buildReplyContextLine(replyTo) {
        if (!replyTo) return '';
        const who = replyTo.authorId ? `<@${replyTo.authorId}>` : (replyTo.authorDisplay || 'nieznany');
        return `-# ↩️ odpowiedź na ${who}: „${this.formatReplyText(replyTo)}”\n`;
    }

    buildPollMessage(candidates) {
        const kekw = `<:z_Kekw:${this.cfg.kekwEmojiId}>`;
        const endUnix = Math.floor((Date.now() + this.cfg.votingDurationMs) / 1000);

        let body = `@everyone\n# 🏆 MVP TYGODNIA — najlepszy tekst na serwerze!\n`;
        body += `W minionym tygodniu padło kilka perełek. Zagłosujcie na **najlepszy tekst** — głosujemy na tekst, nie na osobę!\n\n`;

        candidates.forEach((c, i) => {
            const dateUnix = Math.floor(c.createdTimestamp / 1000);
            body += `${this.cfg.voteEmojis[i]}\n`;
            body += `> ***„${this.formatCandidateText(c)}”***\n`;
            body += this.buildReplyContextLine(c.replyTo);
            const wild = c.isWildcard ? '🃏 *dzika karta od MVP* · ' : '';
            body += `-# ${wild}✍️ <@${c.authorId}> · ${c.kekwCount}× ${kekw} · <#${c.channelId}> · <t:${dateUnix}:f> · [oryginał](${c.url})\n\n`;
        });

        body += `🗳️ **Jak głosować:** kliknij reakcję przy wybranym tekście. Możesz oddać tylko **jeden** głos (kliknięcie innej reakcji usuwa poprzednią).\n`;
        body += `⏳ Głosowanie kończy się <t:${endUnix}:R>.`;
        return body;
    }

    buildNoCandidatesMessage() {
        const kekw = `<:z_Kekw:${this.cfg.kekwEmojiId}>`;
        return `@everyone\n# 😴 MVP TYGODNIA\n` +
            `W tym tygodniu nikt nie zebrał żadnej reakcji ${kekw} — brak kandydatów do tytułu MVP.\n` +
            `Piszcie więcej zabawnych tekstów na czatach! 😄`;
    }

    // ===== Obsługa reakcji (głosowanie) =====

    async handleReactionAdd(reaction, user) {
        try {
            if (user.bot) return;
            if (this.state.phase !== 'voting') return;

            // ID wiadomości i emoji są dostępne także dla partiali — filtruj PRZED jakimkolwiek fetchem
            const message = reaction.message;
            if (message.id !== this.state.pollMessageId) return;

            const optionIndex = this.cfg.voteEmojis.indexOf(reaction.emoji.name);
            // Ważne są tylko reakcje odpowiadające istniejącym kandydatom
            if (optionIndex < 0 || optionIndex >= this.state.candidates.length) {
                try { await reaction.users.remove(user.id); } catch {}
                return;
            }

            const prev = this.state.votes[user.id];
            if (prev === optionIndex) return;

            // Zapisz nowy głos PRZED usunięciem starej reakcji (by zdarzenie usunięcia nie skasowało nowego głosu)
            this.state.votes[user.id] = optionIndex;
            await this.saveState();

            if (prev !== undefined && prev !== optionIndex) {
                const fullMessage = message.partial ? await message.fetch() : message;
                const prevReaction = fullMessage.reactions.cache.find(r => r.emoji.name === this.cfg.voteEmojis[prev]);
                if (prevReaction) {
                    try { await prevReaction.users.remove(user.id); } catch {}
                }
            }
        } catch (error) {
            this.logger.error(`❌ MVP: błąd obsługi reakcji (add): ${error.message}`);
        }
    }

    async handleReactionRemove(reaction, user) {
        try {
            if (user.bot) return;
            if (this.state.phase !== 'voting') return;

            // ID wiadomości i emoji są dostępne także dla partiali — filtruj PRZED jakimkolwiek fetchem
            if (reaction.message.id !== this.state.pollMessageId) return;

            const optionIndex = this.cfg.voteEmojis.indexOf(reaction.emoji.name);
            if (optionIndex < 0) return;

            // Czyść głos tylko gdy usunięta reakcja to aktualnie zapisany wybór użytkownika
            if (this.state.votes[user.id] === optionIndex) {
                delete this.state.votes[user.id];
                await this.saveState();
            }
        } catch (error) {
            this.logger.error(`❌ MVP: błąd obsługi reakcji (remove): ${error.message}`);
        }
    }

    // ===== Aprobata MVP (reakcja KEKW aktualnego MVP pod cudzym postem) =====

    /**
     * Aprobata MVP: gdy aktualny MVP tygodnia (posiadacz roli) zostawi reakcję KEKW pod
     * cudzym postem, bot odpala LOSOWY efekt "stempla aprobaty".
     * Zasada: jeden post = jeden efekt (dedup po messageId). Niezależne od ankiety tygodniowej.
     */
    async handleApprovalReaction(reaction, user) {
        try {
            if (user.bot) return;
            const ac = this.cfg.approval;
            if (!ac || !ac.enabled) return;

            // Tylko reakcja KEKW (dopasowanie po ID — działa też dla partiali)
            if (reaction.emoji?.id !== this.cfg.kekwEmojiId) return;

            const message = reaction.message;
            const channelId = message.channelId || message.channel?.id;

            // Pomijaj kanał ankiety i kanały wykluczone
            if (channelId === this.cfg.pollChannelId) return;
            if (Array.isArray(this.cfg.excludedChannels) && this.cfg.excludedChannels.includes(channelId)) return;

            // Dedup PRZED jakimkolwiek fetchem — jeden post = jeden efekt
            if (this.approvals.messages[message.id]) return;

            // Wymagany kontekst serwera (pomija DM)
            let guild = message.guild;
            if (!guild && message.guildId) {
                try { guild = await this.client.guilds.fetch(message.guildId); } catch { return; }
            }
            if (!guild) return;

            // Czy reagujący to aktualny MVP (posiadacz roli MVP tygodnia)?
            let mvpMember;
            try { mvpMember = await guild.members.fetch(user.id); } catch { return; }
            if (!mvpMember.roles.cache.has(this.cfg.roleId)) return;

            // Pobierz pełną wiadomość, by ustalić autora
            const fullMessage = message.partial ? await message.fetch() : message;
            const author = fullMessage.author;
            if (!author || author.bot) return;
            if (author.id === user.id) return; // brak samo-aprobaty

            // Rezerwacja dedup PO walidacji (anty-double-fire / anty-spam), zanim ruszą efekty async
            this.recordApproval(fullMessage.id, { mvpUserId: user.id, authorId: author.id, effect: 'pending' });

            // Losowanie efektu:
            //  - "szczęśliwy traf" = jackpot sprawdzany PIERWSZY ⇒ ~1% absolutnie (wszystko naraz + embed + dzika karta)
            //  - textreply (znak jakości) z szansą textReplyChance (~30%)
            //  - inaczej równo 1 z puli (embed jest zarezerwowany WYŁĄCZNIE dla jackpota)
            let effect;
            if (Math.random() < (ac.jackpotChance ?? 0.01)) {
                effect = 'jackpot';
            } else if (Math.random() < (ac.textReplyChance ?? 0.3)) {
                effect = 'textreply';
            } else {
                const pool = ['stamp', 'crown'];
                effect = pool[Math.floor(Math.random() * pool.length)];
            }

            const mvpName = mvpMember.displayName || user.username;
            const ctx = { fullMessage, guild, author, mvpName };

            // Jackpot → wypowiedź dostaje "dziką kartę" do najbliższej ankiety MVP (przed efektami, by embed mógł o niej wspomnieć)
            if (effect === 'jackpot' && (ac.wildcardOnJackpot ?? true)) {
                await this.addWildcard(ctx);
            }

            await this.runApprovalEffect(effect, ctx);

            // Zapisz finalny efekt
            if (this.approvals.messages[fullMessage.id]) {
                this.approvals.messages[fullMessage.id].effect = effect;
            }
            await this.saveApprovals();

            this.logger.info(`👑 MVP aprobata: ${mvpName} docenił post ${author.tag} → efekt "${effect}"`);
        } catch (error) {
            this.logger.error(`❌ MVP: błąd obsługi aprobaty: ${error.message}`);
        }
    }

    /**
     * Zapisuje wpis dedup i przycina najstarsze, by plik nie puchł w nieskończoność.
     */
    recordApproval(messageId, data) {
        this.approvals.messages[messageId] = { ...data, at: Date.now() };

        const max = this.cfg.approval?.maxApprovedMemory || 1000;
        const ids = Object.keys(this.approvals.messages);
        if (ids.length > max) {
            const sorted = ids.sort((a, b) =>
                (this.approvals.messages[a].at || 0) - (this.approvals.messages[b].at || 0));
            for (const id of sorted.slice(0, ids.length - max)) {
                delete this.approvals.messages[id];
            }
        }
        // Trwała rezerwacja zanim ruszą efekty (na wypadek restartu w trakcie)
        this.saveApprovals();
    }

    async runApprovalEffect(effect, ctx) {
        if (effect === 'jackpot') {
            await this.effectStamp(ctx);
            await this.effectCrown(ctx);
            await this.effectEmbed(ctx, true);
            return;
        }
        if (effect === 'textreply') return this.effectTextReply(ctx);
        if (effect === 'stamp') return this.effectStamp(ctx);
        if (effect === 'crown') {
            const ok = await this.effectCrown(ctx);
            // Korona może się nie udać (brak uprawnień / wyższa rola) → fallback na znak jakości
            // (NIE embed — embed jest zarezerwowany dla jackpota)
            if (!ok) await this.effectTextReply(ctx);
            return;
        }
    }

    /** Pieczęć: bot dorzuca pod postem zestaw reakcji-stempli. */
    async effectStamp(ctx) {
        const emojis = this.cfg.approval?.stampEmojis || ['👑', '✅', '🔥'];
        for (const e of emojis) {
            try { await ctx.fullMessage.react(e); } catch {}
        }
    }

    /** Embed: bot odpowiada ozdobnym embedem z gratulacjami (losowy tekst). */
    async effectEmbed(ctx, isJackpot) {
        try {
            const text = isJackpot
                ? this.pickRandom(this.approvalJackpotTexts())
                : this.pickRandom(this.approvalEmbedTexts());
            const embed = new EmbedBuilder()
                .setColor(isJackpot ? 0xFFC400 : 0xF1C40F)
                .setTitle(isJackpot ? '🍀 SZCZĘŚLIWY TRAF — Wielka Aprobata MVP!' : '👑 Aprobata MVP tygodnia')
                .setDescription(text)
                .setFooter({ text: `Doceniony przez ${ctx.mvpName} — MVP tygodnia` });
            await ctx.fullMessage.reply({ embeds: [embed], allowedMentions: { repliedUser: true } });
        } catch (error) {
            this.logger.error(`❌ MVP: błąd embedu aprobaty: ${error.message}`);
        }
    }

    /** Znak jakości: bot odpowiada krótkim tekstem (nie embedem) z losowej puli. */
    async effectTextReply(ctx) {
        try {
            const content = this.pickRandom(this.approvalTextReplies());
            await ctx.fullMessage.reply({ content, allowedMentions: { repliedUser: true } });
        } catch (error) {
            this.logger.error(`❌ MVP: błąd odpowiedzi tekstowej aprobaty: ${error.message}`);
        }
    }

    /** Korona: autor docenionego posta dostaje prefix 👑 w nicku na 1h (przez NicknameManager). */
    async effectCrown(ctx) {
        try {
            if (!this.nicknameManager) return false;

            // Brak stackowania — jeśli autor ma już aktywną koronę MVP, pomiń ponowne nadanie
            // (inaczej prefix 👑 nakładałby się: "👑 👑 Nick"). Standalone 'crown' → fallback na textreply.
            if (this.nicknameManager.hasActiveEffect(ctx.author.id) &&
                this.nicknameManager.getActiveEffectType(ctx.author.id) === 'mvp_crown') {
                this.logger.info(`👑 MVP: ${ctx.author.tag} ma już aktywną koronę — pomijam (brak stackowania)`);
                return false;
            }

            const member = await ctx.guild.members.fetch(ctx.author.id);
            if (!member.manageable) {
                this.logger.warn(`⚠️ MVP: brak uprawnień do korony dla ${member.user.tag} (wyższa rola/owner)`);
                return false;
            }
            const prefix = this.cfg.approval?.crownPrefix || '👑';
            const duration = this.cfg.approval?.crownDurationMs || 60 * 60 * 1000;
            await this.nicknameManager.applyEffect(
                ctx.author.id,
                'mvp_crown',
                duration,
                { guildId: ctx.guild.id, appliedBy: 'MVP tygodnia' },
                member,
                prefix
            );
            return true;
        } catch (error) {
            this.logger.error(`❌ MVP: błąd nadawania korony: ${error.message}`);
            return false;
        }
    }

    pickRandom(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    approvalEmbedTexts() {
        return [
            'Sam MVP tygodnia przybił pieczątkę jakości pod tym tekstem. 🏆',
            'To się nazywa klasa — aprobata prosto od MVP tygodnia! 👏',
            'MVP tygodnia ogłasza: ten wpis przechodzi do historii. 📜',
            'Stempel jakości przyznany. Brawo! 🔥',
            'MVP tygodnia kłania się przed tym tekstem. 🙇',
            'Oficjalnie docenione przez najlepszego mówcę tygodnia. 🎖️'
        ];
    }

    approvalJackpotTexts() {
        return [
            'JACKPOT! 🍀 MVP tygodnia uznaje to za arcydzieło — ta wypowiedź dostaje **dziką kartę** 🃏 do cotygodniowego losowania MVP!',
            'Wszystkie gwiazdy się zgrały — pełnia aprobaty MVP 👑✅🔥 i **dzika karta** 🃏 prosto do ankiety MVP tygodnia!',
            'Niebywałe! Szczęśliwy traf — ten tekst wskakuje jako **dzika karta** 🃏 do walki o tytuł MVP tygodnia!'
        ];
    }

    approvalTextReplies() {
        return [
            'Przyznano znak jakości wypowiedzi! 🏅',
            'Ta wypowiedź otrzymuje znak jakości MVP! 🛡️',
            'Certyfikat jakości MVP przyznany! 📜✨',
            'Oficjalny znak jakości od MVP tygodnia! 🏆',
            'Brawo! MVP tygodnia nadaje tej wypowiedzi znak jakości. ✅',
            'Ta wypowiedź przeszła kontrolę jakości MVP! 🔎👌',
            'Znak jakości przyznany — tak mówi MVP tygodnia! 🥇',
            'MVP tygodnia stawia tu swój znak jakości! ⭐'
        ];
    }

    // ===== Dzika karta (jackpot → dodatkowy tekst w najbliższej ankiecie MVP) =====

    /** Zapisuje wypowiedź jako "dziką kartę" — kandydat-kształtny obiekt do scalenia przy skanie. */
    async addWildcard(ctx) {
        try {
            const msg = ctx.fullMessage;

            // Kontekst odpowiedzi (jak w collectFromChannel)
            let replyTo = null;
            if (msg.reference && msg.reference.messageId) {
                try {
                    const ref = await msg.fetchReference();
                    if (ref) {
                        replyTo = {
                            authorId: ref.author?.id || null,
                            authorDisplay: ref.member?.displayName || ref.author?.username || 'nieznany',
                            content: ref.content || '',
                            hasAttachment: (ref.attachments?.size || 0) > 0
                        };
                    }
                } catch (e) { /* oryginał usunięty/niedostępny - pomijamy kontekst */ }
            }

            const kekwReaction = msg.reactions.cache.find(r => r.emoji?.id === this.cfg.kekwEmojiId);
            const kekwCount = kekwReaction?.count || 1;

            const wildcard = {
                messageId: msg.id,
                channelId: msg.channelId || msg.channel?.id,
                authorId: ctx.author.id,
                authorTag: ctx.author.tag,
                authorDisplay: msg.member?.displayName || ctx.author.username,
                content: msg.content || '',
                hasAttachment: msg.attachments.size > 0,
                kekwCount,
                otherReactionsCount: 0,
                createdTimestamp: msg.createdTimestamp,
                url: msg.url,
                replyTo,
                isWildcard: true,
                addedAt: Date.now()
            };

            // Dedup — nie dubluj tej samej wiadomości jako dzikiej karty
            if (!this.approvals.wildcards.some(w => w.messageId === wildcard.messageId)) {
                this.approvals.wildcards.push(wildcard);
                await this.saveApprovals();
                this.logger.info(`🃏 MVP: nadano dziką kartę wypowiedzi ${ctx.author.tag} (do najbliższej ankiety MVP)`);
            }
        } catch (error) {
            this.logger.error(`❌ MVP: błąd nadawania dzikiej karty: ${error.message}`);
        }
    }

    /** Scala dzikie karty (w oknie skanu) z normalnie wybranymi kandydatami — karty są gwarantowane. */
    mergeWildcards(selected, windowStart) {
        const active = (this.approvals.wildcards || []).filter(w => (w.addedAt || 0) >= windowStart);
        // Pomijaj karty, które i tak są już w zestawieniu (po messageId)
        const fresh = active.filter(w => !selected.some(c => c.messageId === w.messageId));
        if (fresh.length === 0) return selected;

        // Gwarancja kart: rezerwuj im sloty, resztę wypełnij normalnymi kandydatami; twardy limit = liczba emoji
        const maxNormal = Math.max(0, this.cfg.maxCandidates - fresh.length);
        const combined = [...selected.slice(0, maxNormal), ...fresh];
        return combined.slice(0, this.cfg.maxCandidates);
    }

    /** Czyści zużyte dzikie karty po wystawieniu ankiety. */
    async consumeWildcards() {
        if (!this.approvals.wildcards || this.approvals.wildcards.length === 0) return;
        this.approvals.wildcards = [];
        await this.saveApprovals();
    }

    // ===== Finalizacja =====

    async finishVoting() {
        if (this.state.phase !== 'voting') return;
        this.clearFinishTimer();

        const { channelId, candidates } = this.state;
        try {
            // Zliczanie z zapamiętanej mapy głosów (ostatni klik = ważny głos).
            // Odporne na brak uprawnienia "Zarządzanie wiadomościami" i na restart bota.
            const tally = this.tallyFromState(candidates.length);

            let winnerIndex = 0;
            for (let i = 1; i < candidates.length; i++) {
                const w = candidates[winnerIndex];
                const c = candidates[i];
                const better = tally[i] > tally[winnerIndex] ||
                    (tally[i] === tally[winnerIndex] && (
                        c.kekwCount > w.kekwCount ||
                        (c.kekwCount === w.kekwCount && (
                            c.otherReactionsCount > w.otherReactionsCount ||
                            (c.otherReactionsCount === w.otherReactionsCount && c.createdTimestamp < w.createdTimestamp)
                        ))
                    ));
                if (better) winnerIndex = i;
            }

            const winner = candidates[winnerIndex];
            await this.awardRole(winner.authorId);
            await this.recordWinner(winner);

            const channel = await this.client.channels.fetch(channelId || this.cfg.pollChannelId);
            await channel.send({
                content: this.buildWinnerMessage(winner, tally, candidates, winnerIndex),
                allowedMentions: { parse: ['everyone'] }
            });
            this.logger.info(`🏆 MVP: zwycięzca ${winner.authorTag} (kandydat ${winnerIndex + 1}, ${tally[winnerIndex]} głos(ów))`);
        } catch (error) {
            this.logger.error(`❌ MVP: błąd finalizacji głosowania: ${error.message}`);
        } finally {
            this.state = this.emptyState();
            await this.saveState();
        }
    }

    async fetchAllReactors(reaction) {
        const result = [];
        let after;
        while (true) {
            const options = { limit: 100 };
            if (after) options.after = after;
            const users = await reaction.users.fetch(options);
            if (users.size === 0) break;
            for (const u of users.values()) result.push(u);
            if (users.size < 100) break;
            after = users.last().id;
        }
        return result;
    }

    /**
     * Zlicza głosy z zapamiętanej mapy state.votes (userId -> optionIndex).
     * To źródło prawdy odzwierciedla "jeden głos na osobę = ostatni klik".
     */
    tallyFromState(candidateCount) {
        const counts = new Array(candidateCount).fill(0);
        const botId = this.client?.user?.id;
        for (const [userId, opt] of Object.entries(this.state.votes || {})) {
            if (botId && userId === botId) continue; // Nie liczymy głosów bota
            if (typeof opt === 'number' && opt >= 0 && opt < candidateCount) counts[opt]++;
        }
        return counts;
    }

    /**
     * Synchronizuje mapę głosów ze stanem reakcji po restarcie (best-effort).
     */
    async resyncVotes() {
        try {
            const channel = await this.client.channels.fetch(this.state.channelId);
            const message = await channel.messages.fetch(this.state.pollMessageId);
            const userOptions = new Map();
            for (let i = 0; i < this.state.candidates.length; i++) {
                const reaction = message.reactions.cache.find(r => r.emoji.name === this.cfg.voteEmojis[i]);
                if (!reaction) continue;
                const users = await this.fetchAllReactors(reaction);
                for (const u of users) {
                    if (u.bot) continue;
                    if (!userOptions.has(u.id)) userOptions.set(u.id, []);
                    userOptions.get(u.id).push(i);
                }
            }
            const votes = {};
            for (const [userId, opts] of userOptions.entries()) {
                if (opts.length === 1) votes[userId] = opts[0];
            }
            this.state.votes = votes;
            await this.saveState();
        } catch (error) {
            this.logger.warn(`⚠️ MVP: nie udało się zsynchronizować głosów po restarcie: ${error.message}`);
        }
    }

    buildWinnerMessage(winner, tally, candidates, winnerIndex) {
        const kekw = `<:z_Kekw:${this.cfg.kekwEmojiId}>`;
        let body = `@everyone\n# 👑 MVP TYGODNIA wyłoniony!\n`;
        body += `Zwyciężył tekst, który napisał(a) <@${winner.authorId}>! 🎉\n\n`;
        body += `> ***„${this.formatCandidateText(winner)}”***\n`;
        body += this.buildReplyContextLine(winner.replyTo);
        body += `-# ✍️ <@${winner.authorId}> · ${winner.kekwCount}× ${kekw} · <#${winner.channelId}> · [oryginał](${winner.url})\n\n`;
        body += `📊 **Wyniki głosowania:**\n`;
        candidates.forEach((c, i) => {
            const marker = i === winnerIndex ? '👑' : '▫️';
            body += `${marker} ${this.cfg.voteEmojis[i]} — **${tally[i]}** głos(ów) (<@${c.authorId}>)\n`;
        });
        const winnerCount = (this.winners[winner.authorId]?.count) || 1;
        body += `\n🏅 <@${winner.authorId}> otrzymuje rolę MVP na najbliższy tydzień! To już **${winnerCount}.** tytuł MVP tej osoby.`;
        return body;
    }

    // ===== Rola =====

    async awardRole(winnerUserId) {
        try {
            const guild = await this.getGuild();
            const roleId = this.cfg.roleId;

            // Upewnij się, że cache członków jest pełny (potrzebne do role.members)
            try { await guild.members.fetch(); } catch (e) {
                this.logger.warn(`⚠️ MVP: nie udało się pobrać pełnej listy członków: ${e.message}`);
            }

            const role = guild.roles.cache.get(roleId);
            if (role) {
                for (const member of role.members.values()) {
                    if (member.id === winnerUserId) continue;
                    try {
                        await member.roles.remove(roleId, 'MVP tygodnia - reset poprzedniego zwycięzcy');
                    } catch (e) {
                        this.logger.warn(`⚠️ MVP: nie usunięto roli ${member.id}: ${e.message}`);
                    }
                }
            }

            const winnerMember = await guild.members.fetch(winnerUserId).catch(() => null);
            if (winnerMember) {
                await winnerMember.roles.add(roleId, 'MVP tygodnia - zwycięzca');
                this.logger.info(`🏅 MVP: przyznano rolę zwycięzcy ${winnerUserId}`);
            } else {
                this.logger.warn(`⚠️ MVP: zwycięzca ${winnerUserId} nie jest już na serwerze - rola nie przyznana`);
            }
        } catch (error) {
            this.logger.error(`❌ MVP: błąd przy zarządzaniu rolą: ${error.message}`);
        }
    }

    async recordWinner(winner) {
        const entry = this.winners[winner.authorId] || { count: 0, username: winner.authorTag };
        entry.count += 1;
        entry.username = winner.authorDisplay || winner.authorTag || entry.username;
        entry.lastWonAt = Date.now();
        this.winners[winner.authorId] = entry;
        this.currentWinnerId = winner.authorId;
        await this.saveWinners();
    }

    /**
     * Zwraca ranking zdobywców MVP (malejąco wg liczby tytułów).
     */
    getRanking() {
        return Object.entries(this.winners)
            .map(([userId, data]) => ({
                userId,
                count: data.count || 0,
                username: data.username || userId,
                lastWonAt: data.lastWonAt || 0
            }))
            .sort((a, b) => b.count - a.count || b.lastWonAt - a.lastWonAt);
    }

    // ===== Pomocnicze =====

    async getGuild() {
        return this.client.guilds.cache.get(this.config.guildId) ||
            await this.client.guilds.fetch(this.config.guildId);
    }
}

module.exports = MvpService;
