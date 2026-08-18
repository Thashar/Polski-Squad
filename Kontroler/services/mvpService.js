const { ChannelType, PermissionsBitField, EmbedBuilder } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');
const NicknameManager = require('../../utils/nicknameManagerService');
const { polandWallClockToUTC, getPolandParts, formatPolandDateTime } = require('../utils/timezone');
const store = require('../../utils/jsonStore');
const { poprzedniTermin, ostatnieWykonanie, oznaczWykonanie } = require('../../utils/cronCatchUp');

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
            this.state = { ...this.emptyState(), ...(await store.getOrLoad(this.stateFile, () => ({}))) };
        } catch (error) {
            if (error.code !== 'ENOENT') {
                this.logger.error(`❌ MVP: błąd ładowania stanu: ${error.message}`);
            }
            this.state = this.emptyState();
        }
    }

    async saveState() {
        try {
            await store.set(this.stateFile, this.state);
        } catch (error) {
            this.logger.error(`❌ MVP: błąd zapisu stanu: ${error.message}`);
        }
    }

    async loadWinners() {
        try {
            const parsed = await store.getOrLoad(this.winnersFile, () => ({}));
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
            await store.set(this.winnersFile, {
                winners: this.winners,
                currentWinnerId: this.currentWinnerId
            });
        } catch (error) {
            this.logger.error(`❌ MVP: błąd zapisu zwycięzców: ${error.message}`);
        }
    }

    async loadApprovals() {
        try {
            const parsed = await store.getOrLoad(this.approvalsFile, () => ({}));
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
            await store.set(this.approvalsFile, this.approvals);
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
        await this.catchUpMissedScan();
    }

    /** Wyrażenie crona odpowiadające konfiguracji skanu — do liczenia poprzedniego terminu. */
    _wyrazenieHarmonogramu() {
        return `${this.cfg.scheduleMinute} ${this.cfg.scheduleHour} * * ${this.cfg.scheduleWeekday}`;
    }

    /**
     * Nadrabia skan pominięty, gdy bot był wyłączony o zaplanowanej godzinie.
     *
     * ⚠️ Skan odpalał WYŁĄCZNIE `setTimeout` ustawiany przy starcie, więc przestój
     * w czwartek o 22:05 oznaczał, że `scheduleNextScan()` planowało dopiero KOLEJNY
     * czwartek — tydzień bez ankiety MVP, bez śladu w logu i bez możliwości odzyskania
     * (nie ma komendy do ręcznego odpalenia skanu).
     *
     * ⚠️ KONSEKWENCJA nadrabiania: ankieta trafia na kanał z pingiem `@everyone` o porze
     * startu bota, a nie o 22:05, i trwa 24 h od TEGO momentu. Przy nadrobieniu tuż przed
     * kolejnym czwartkiem `runWeeklyScan()` zobaczy `phase === 'voting'` i pominie nowy skan
     * — czyli jedna ankieta zamiast dwóch, ale przesunięta w czasie.
     *
     * Przy pierwszym uruchomieniu (brak znacznika) nic nie nadrabiamy — zapisujemy tylko
     * punkt odniesienia, żeby mechanizm zadziałał od następnego terminu.
     */
    async catchUpMissedScan() {
        const ID = 'kontroler:mvp-skan';

        try {
            if (this.state.phase === 'voting') return false;

            const ostatni = await ostatnieWykonanie(ID);
            if (ostatni === null) {
                await oznaczWykonanie(ID);
                return false;
            }

            const poprzedni = poprzedniTermin(this._wyrazenieHarmonogramu(), 'Europe/Warsaw');
            if (ostatni >= poprzedni.getTime()) return false;

            this.logger.warn(`⚠️ MVP: skan z ${formatPolandDateTime(poprzedni)} został pominięty (bot nie działał) — nadrabiam teraz`);
            await this.runWeeklyScan();
            return true;
        } catch (error) {
            this.logger.error(`❌ MVP: błąd nadrabiania pominiętego skanu: ${error.message}`);
            return false;
        }
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
                await channel.send(this.buildNoCandidatesPayload());
                this.logger.info('📭 MVP: brak kandydatów w tym tygodniu - ogłoszono brak');
                return;
            }

            await this.startPoll(channel, candidates);
            // Dzikie karty zostały wystawione w ankiecie — czyścimy, by nie przeszły na kolejny tydzień
            await this.consumeWildcards();
        } catch (error) {
            this.logger.error(`❌ MVP: błąd cotygodniowego skanu: ${error.message}`);
        } finally {
            // Znacznik zapisujemy TAKŻE po błędzie — inaczej nieudany skan nadrabiałby się
            // w kółko przy każdym starcie bota
            await oznaczWykonanie('kontroler:mvp-skan').catch(() => {});
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
                // Jeśli wiadomość jest odpowiedzią na inną (riposta) - zapamiętaj kontekst oryginału
                const replyTo = await this.buildReplyContext(msg);
                candidates.push({
                    messageId: msg.id,
                    channelId: channel.id,
                    authorId: msg.author.id,
                    authorTag: msg.author.tag,
                    authorDisplay: msg.member?.displayName || msg.author.username,
                    authorAvatar: this.extractAvatarUrl(msg.author),
                    content: msg.content || '',
                    hasAttachment: msg.attachments.size > 0,
                    imageUrl: this.extractImageUrl(msg),
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
        const pollMessage = await channel.send(this.buildPollPayload(candidates));

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

    // ===== Media i kontekst riposty =====

    /** Awatar użytkownika (stały link CDN - nie wygasa, w przeciwieństwie do załączników). */
    extractAvatarUrl(user) {
        try {
            return user?.displayAvatarURL?.({ extension: 'png', size: 128 }) || null;
        } catch {
            return null;
        }
    }

    /** URL pierwszego obrazka wiadomości - załącznik graficzny lub obrazek z auto-embeda (np. tenor). */
    extractImageUrl(message) {
        try {
            const attachment = message.attachments?.find(a =>
                (a.contentType && a.contentType.startsWith('image/')) ||
                /\.(png|jpe?g|gif|webp)(\?|$)/i.test(a.name || a.url || '')
            );
            if (attachment) return attachment.url;

            const embedWithImage = message.embeds?.find(e => e.image?.url || e.thumbnail?.url);
            if (embedWithImage) return embedWithImage.image?.url || embedWithImage.thumbnail?.url;
        } catch {
            // Wiadomość częściowa/niedostępna - brak obrazka
        }
        return null;
    }

    /**
     * Kontekst riposty: na jaką wypowiedź odpowiada kandydat (autor, treść, obrazek, link).
     * Zwraca null gdy wiadomość nie jest odpowiedzią lub oryginał został usunięty.
     */
    async buildReplyContext(message) {
        if (!message.reference || !message.reference.messageId) return null;
        try {
            const ref = await message.fetchReference();
            if (!ref) return null;
            return {
                authorId: ref.author?.id || null,
                authorDisplay: ref.member?.displayName || ref.author?.username || 'nieznany',
                authorAvatar: this.extractAvatarUrl(ref.author),
                content: ref.content || '',
                hasAttachment: (ref.attachments?.size || 0) > 0,
                imageUrl: this.extractImageUrl(ref),
                url: ref.url || null
            };
        } catch (e) {
            // Oryginalna wiadomość mogła zostać usunięta lub jest niedostępna - pomijamy kontekst riposty
            return null;
        }
    }

    /**
     * Uzupełnia dane kandydata tuż przed publikacją ogłoszenia:
     * - dociąga awatar, jeśli stan pochodzi sprzed tej wersji,
     * - odświeża podpisany link do załącznika (linki CDN Discorda wygasają po ~24h).
     */
    async hydrateCandidate(c) {
        if (!c.authorAvatar && c.authorId) {
            try {
                const user = await this.client.users.fetch(c.authorId);
                c.authorAvatar = this.extractAvatarUrl(user);
            } catch {
                // Użytkownik usunięty/niedostępny - embed pójdzie bez awatara
            }
        }

        if (!c.imageUrl && !c.replyTo?.imageUrl) return;
        try {
            const channel = await this.client.channels.fetch(c.channelId);
            const message = await channel.messages.fetch(c.messageId);
            const fresh = this.extractImageUrl(message);
            if (fresh) c.imageUrl = fresh;

            if (c.replyTo?.imageUrl && message.reference) {
                const ref = await message.fetchReference();
                const freshRef = this.extractImageUrl(ref);
                if (freshRef) c.replyTo.imageUrl = freshRef;
            }
        } catch {
            // Wiadomość usunięta/niedostępna - zostaje zapisany (możliwe, że wygasły) link
        }
    }

    // ===== Prezentacja (embedy) =====

    kekwEmoji() {
        return `<:z_Kekw:${this.cfg.kekwEmojiId}>`;
    }

    /** Paleta kolejnych wypowiedzi - spójna, wyrazista gama; dzika karta zawsze fioletowa. */
    candidateColor(index, isWildcard) {
        if (isWildcard) return 0x9B59B6;
        const palette = [0xF1C40F, 0xE67E22, 0x3498DB, 0x2ECC71, 0xE91E63, 0x1ABC9C, 0xE74C3C, 0xFF7043, 0x00BCD4, 0x8E44AD];
        return palette[index % palette.length];
    }

    formatQuoteText(c, maxLength = 400) {
        let t = (c.content || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
        if (t.length > maxLength) t = t.slice(0, maxLength - 1).trimEnd() + '…';
        return t;
    }

    /** Cytat wypowiedzi jako blok cytatu - zachowuje łamanie linii, domyka cudzysłowy. */
    buildQuoteBlock(c) {
        const text = this.formatQuoteText(c);
        if (!text) {
            if (c.imageUrl) return '> *(bez słów — cała siła w obrazku)*';
            return c.hasAttachment ? '> *(załącznik bez treści tekstowej)*' : '> *(brak treści tekstowej)*';
        }

        const lines = text.split('\n');
        return lines.map((line, i) => {
            const trimmed = line.trim();
            if (!trimmed) return '> ';
            const open = i === 0 ? '„' : '';
            const close = i === lines.length - 1 ? '”' : '';
            return `> ***${open}${trimmed}${close}***`;
        }).join('\n');
    }

    /**
     * Pole „riposta" - na jaką wypowiedź odpowiada kandydat.
     * Nicki podajemy tekstem (nie wzmianką), bo embed pokazuje surowe ID gdy user nie jest w cache.
     */
    buildReplyField(c, imageFromReply) {
        const r = c.replyTo;
        if (!r) return null;

        let snippet = (r.content || '').replace(/\s+/g, ' ').trim();
        if (snippet.length > 160) snippet = snippet.slice(0, 159) + '…';
        if (!snippet) snippet = r.imageUrl ? '[obrazek]' : (r.hasAttachment ? '[załącznik]' : '[brak treści]');

        const jump = r.url ? ` · [↗ oryginał](${r.url})` : '';
        const note = imageFromReply ? '\n*(obrazek poniżej pochodzi z tej wypowiedzi)*' : '';
        return {
            name: '↩️ Riposta na wypowiedź',
            value: `**${r.authorDisplay || 'nieznany'}**${jump}\n> *„${snippet}”*${note}`,
            inline: false
        };
    }

    /** Jeden kandydat = jeden embed: cytat, riposta, statystyki, obrazek i awatar autora. */
    buildCandidateEmbed(c, index) {
        const emoji = this.cfg.voteEmojis[index] || '▫️';
        const embed = new EmbedBuilder()
            .setColor(this.candidateColor(index, c.isWildcard))
            .setAuthor({
                name: `${emoji}  ${c.authorDisplay || c.authorTag || 'nieznany'}`,
                url: c.url || undefined
            })
            .setDescription(this.buildQuoteBlock(c))
            .setFooter({ text: `Zagłosuj reakcją ${emoji}` })
            .setTimestamp(c.createdTimestamp || Date.now());

        if (c.isWildcard) embed.setTitle('🃏 Dzika karta od MVP');
        if (c.authorAvatar) embed.setThumbnail(c.authorAvatar);

        // Obrazek własny kandydata ma pierwszeństwo; gdy go nie ma, pokazujemy obrazek ripostowanej wypowiedzi
        const imageFromReply = !c.imageUrl && !!c.replyTo?.imageUrl;
        const image = c.imageUrl || c.replyTo?.imageUrl;
        if (image) embed.setImage(image);

        const fields = [];
        const replyField = this.buildReplyField(c, imageFromReply);
        if (replyField) fields.push(replyField);
        fields.push(
            { name: '😹 Zebrane KEKW', value: `**${c.kekwCount}** × ${this.kekwEmoji()}`, inline: true },
            { name: '📍 Kanał', value: `<#${c.channelId}>`, inline: true }
        );
        if (c.url) fields.push({ name: '🔗 Źródło', value: `[przejdź do wypowiedzi](${c.url})`, inline: true });
        embed.addFields(fields);

        return embed;
    }

    buildPollPayload(candidates) {
        const endUnix = Math.floor((Date.now() + this.cfg.votingDurationMs) / 1000);

        let content = `@everyone\n# 🏆 MVP TYGODNIA — najlepsza wypowiedź minionego tygodnia\n`;
        content += `W ostatnich ${this.cfg.scanDays} dniach padło kilka perełek ${this.kekwEmoji()} — wybierzcie tę **jedną**. `;
        content += `Głosujemy na **wypowiedź**, nie na osobę!`;

        const embeds = candidates.map((c, i) => this.buildCandidateEmbed(c, i));

        // Stopka z zasadami - tylko gdy zmieści się w twardym limicie 10 embedów na wiadomość
        if (embeds.length <= 9) {
            const usedEmojis = candidates.map((_, i) => this.cfg.voteEmojis[i]).join(' ');
            embeds.push(new EmbedBuilder()
                .setColor(0x2B2D31)
                .setDescription(
                    `🗳️ **Jak głosować:** kliknij reakcję ${usedEmojis} pod tą wiadomością.\n` +
                    `👤 Jedna osoba = **jeden** głos (kliknięcie innej reakcji kasuje poprzednią).\n` +
                    `⏳ Głosowanie kończy się <t:${endUnix}:R> · <t:${endUnix}:f>`
                ));
        }

        return { content, embeds, allowedMentions: { parse: ['everyone'] } };
    }

    buildNoCandidatesPayload() {
        const embed = new EmbedBuilder()
            .setColor(0x5D6D7E)
            .setTitle('😴 MVP TYGODNIA — brak kandydatów')
            .setDescription(
                `W tym tygodniu żadna wypowiedź nie zebrała reakcji ${this.kekwEmoji()}, więc nie ma z czego wybierać.\n\n` +
                `Piszcie więcej zabawnych tekstów na czatach — tytuł czeka! 😄`
            )
            .setFooter({ text: 'Rola MVP pozostaje przy dotychczasowym zwycięzcy' })
            .setTimestamp();

        return {
            content: '@everyone',
            embeds: [embed],
            allowedMentions: { parse: ['everyone'] }
        };
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

            // Losowanie efektu wg stałych szans (pojedynczy los, progi skumulowane):
            //  jackpot ~1% → textreply ~9% → korona ~60% → pieczęć ~30% (reszta, zawsze domyka do 100%).
            //  Embed i dzika karta są zarezerwowane WYŁĄCZNIE dla jackpota.
            const jackpotChance = ac.jackpotChance ?? 0.01;
            const textReplyChance = ac.textReplyChance ?? 0.09;
            const crownChance = ac.crownChance ?? 0.60;
            const roll = Math.random();
            let effect;
            if (roll < jackpotChance) {
                effect = 'jackpot';
            } else if (roll < jackpotChance + textReplyChance) {
                effect = 'textreply';
            } else if (roll < jackpotChance + textReplyChance + crownChance) {
                effect = 'crown';
            } else {
                effect = 'stamp';
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
        const emojis = this.cfg.approval?.stampEmojis || ['🏅', '⭐', '💯', '🔥', '👏', '🏆'];
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

            // Kontekst riposty (jak w collectFromChannel)
            const replyTo = await this.buildReplyContext(msg);

            const kekwReaction = msg.reactions.cache.find(r => r.emoji?.id === this.cfg.kekwEmojiId);
            const kekwCount = kekwReaction?.count || 1;

            const wildcard = {
                messageId: msg.id,
                channelId: msg.channelId || msg.channel?.id,
                authorId: ctx.author.id,
                authorTag: ctx.author.tag,
                authorDisplay: msg.member?.displayName || ctx.author.username,
                authorAvatar: this.extractAvatarUrl(ctx.author),
                content: msg.content || '',
                hasAttachment: msg.attachments.size > 0,
                imageUrl: this.extractImageUrl(msg),
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
            await channel.send(await this.buildWinnerPayload(winner, tally, candidates, winnerIndex));
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

    /** Pasek postępu wyniku głosowania. */
    buildVoteBar(count, maxCount, size = 10) {
        const filled = maxCount > 0 ? Math.round((count / maxCount) * size) : 0;
        return '▰'.repeat(filled) + '▱'.repeat(Math.max(0, size - filled));
    }

    /**
     * Ogłoszenie zwycięzcy: embed ze zwycięską wypowiedzią (cytat, riposta, obrazek, awatar)
     * + embed z wynikami głosowania.
     */
    async buildWinnerPayload(winner, tally, candidates, winnerIndex) {
        await this.hydrateCandidate(winner);

        const totalVotes = tally.reduce((sum, v) => sum + v, 0);
        const maxVotes = Math.max(...tally, 0);
        const winnerCount = (this.winners[winner.authorId]?.count) || 1;

        const content = `@everyone\n# 👑 MVP TYGODNIA wyłoniony!\n` +
            `Zwyciężyła wypowiedź, którą napisał(a) <@${winner.authorId}> — gratulacje! 🎉`;

        const winnerEmbed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setAuthor({
                name: `👑  ${winner.authorDisplay || winner.authorTag || 'nieznany'}`,
                url: winner.url || undefined
            })
            .setTitle('🏆 Zwycięska wypowiedź tygodnia')
            .setDescription(this.buildQuoteBlock(winner))
            .setFooter({ text: `To już ${winnerCount}. tytuł MVP tej osoby · rola MVP na najbliższy tydzień` })
            .setTimestamp(winner.createdTimestamp || Date.now());

        if (winner.authorAvatar) winnerEmbed.setThumbnail(winner.authorAvatar);

        const imageFromReply = !winner.imageUrl && !!winner.replyTo?.imageUrl;
        const image = winner.imageUrl || winner.replyTo?.imageUrl;
        if (image) winnerEmbed.setImage(image);

        const fields = [];
        const replyField = this.buildReplyField(winner, imageFromReply);
        if (replyField) fields.push(replyField);
        fields.push(
            { name: '🗳️ Głosy', value: `**${tally[winnerIndex]}** z ${totalVotes}`, inline: true },
            { name: '😹 Zebrane KEKW', value: `**${winner.kekwCount}** × ${this.kekwEmoji()}`, inline: true },
            { name: '📍 Kanał', value: `<#${winner.channelId}>`, inline: true }
        );
        if (winner.url) fields.push({ name: '🔗 Źródło', value: `[przejdź do wypowiedzi](${winner.url})`, inline: true });
        winnerEmbed.addFields(fields);

        // Nicki tekstem, nie wzmianką - embed pokazuje surowe ID, gdy user nie jest w cache klienta
        const rows = candidates.map((c, i) => {
            const marker = i === winnerIndex ? '👑' : '▫️';
            const percent = totalVotes > 0 ? Math.round((tally[i] / totalVotes) * 100) : 0;
            const wild = c.isWildcard ? ' 🃏' : '';
            return `${marker} ${this.cfg.voteEmojis[i]} \`${this.buildVoteBar(tally[i], maxVotes)}\` **${tally[i]}** (${percent}%) — ${c.authorDisplay || c.authorTag}${wild}`;
        });

        const resultsEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('📊 Wyniki głosowania')
            .setDescription(rows.join('\n'))
            .setFooter({ text: `Oddano ${totalVotes} głos(ów) · ${candidates.length} wypowiedzi w zestawieniu` });

        return {
            content,
            embeds: [winnerEmbed, resultsEmbed],
            allowedMentions: { parse: ['everyone'] }
        };
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
