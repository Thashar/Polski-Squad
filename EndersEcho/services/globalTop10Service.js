'use strict';

const fs   = require('fs');
const path = require('path');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');
const { getOwnerId, getProfileIndex, formatProfileDisplayName } = require('../utils/helpers');
const { formatMessage } = require('../utils/helpers');
const GlobalPositionHistoryService = require('./globalPositionHistoryService');
const store = require('../../utils/jsonStore');

const logger = createBotLogger('EndersEcho');

// Interwał: 9 raportów (bossów) na sezon, co 3 dni, potem 4 dni przerwy (dzień odpoczynku + boss1 nowego sezonu), powtórz
// UWAGA: CYCLE_LEN = liczba RAPORTÓW w sezonie (9), NIE liczba wszystkich pozycji cyklu (poprzednio błędnie 10,
// co wstawiało dodatkowy, 10. raport przed każdą kolejną przerwą i przesuwało harmonogram o cały sezon w przód)
const CYCLE_LEN          = 9;
const REPORT_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000; // 3 dni
const BREAK_INTERVAL_MS  = 4 * 24 * 60 * 60 * 1000;  // 4 dni

const CHECK_INTERVAL_MS  = 60_000; // sprawdzaj co minutę

/** Ile dni wstecz obejmuje wykres zmian pozycji pod raportem. */
const CHART_WINDOW_DAYS = 84;
/** Nazwa załącznika z wykresem — ta sama w embedzie i w AttachmentBuilder. */
const CHART_FILE = 'top10_positions.png';
/** Twardy limit wpisów historii — 84 dni to ok. 25 raportów, reszta to zapas. */
const MAX_HISTORY_REPORTS = 40;

class GlobalTop10Service {
    /**
     * @param {string} dataDir                ścieżka do EndersEcho/data/
     * @param {object} rankingService         RankingService
     * @param {object} guildConfigService     GuildConfigService
     * @param {object} config                 config bota
     * @param {object} client                 Discord.js Client (ustawiany później przez setClient)
     */
    constructor(dataDir, rankingService, guildConfigService, config) {
        this.dataDir          = dataDir;
        this.rankingService   = rankingService;
        this.guildConfigService = guildConfigService;
        this.config           = config;
        this.client           = null;
        this._configFile      = path.join(dataDir, 'global_top10_config.json');
        // Historia wysłanych raportów — jeden wpis na ogłoszenie, źródło wykresu zmian pozycji.
        // Konfiguracja trzyma wyłącznie OSTATNI snapshot, więc bez tego pliku nie da się
        // narysować niczego wstecz.
        this._historyFile     = path.join(dataDir, 'global_top10_history.json');
        this._cfg             = null;
        this._timer           = null;
        // Zbiorcze liczniki reakcji pod raportem — wstrzykiwane z index.js (setterem, bo
        // serwis powstaje wcześniej niż broadcastReactionService)
        this.broadcastReactionService = null;
        // Historia pozycji globalnych — „na tej pozycji od" pod każdym graczem i Hall of Fame
        // miejsca #1 pod raportem. Setterem, bo serwis powstaje po tym (potrzebuje rankingService).
        this.positionHistoryService = null;
        // Generator wykresu zmian pozycji — setterem, bo chartService jest zwykłym modułem
        // funkcji, a serwis ma działać także bez niego (wykres jest dodatkiem, nie warunkiem)
        this.chartService = null;
    }

    /** @param {Object} service - chartService (generateTop10PositionChart) */
    setChartService(service) {
        this.chartService = service;
    }

    /** @param {Object} service - BroadcastReactionService */
    setBroadcastReactionService(service) {
        this.broadcastReactionService = service;
    }

    /** @param {Object} service - GlobalPositionHistoryService */
    setPositionHistoryService(service) {
        this.positionHistoryService = service;
    }

    setClient(client) {
        this.client = client;
    }

    // ── persistence ────────────────────────────────────────────────────────────

    _load() {
        try {
            this._cfg = store.getSync(this._configFile, () => ({}));
        } catch {
            this._cfg = {
                enabled:      false,
                firstTrigger: null,
                nextTrigger:  null,
                triggerCount: 0,
                lastSnapshot: {},   // { [playerKey]: position }
            };
        }
    }

    _save() {
        store.setSync(this._configFile, this._cfg);
    }

    getConfig() {
        return { ...this._cfg };
    }

    // ── historia ogłoszeń (źródło wykresu zmian pozycji) ──────────────────────

    /**
     * Wczytuje historię wysłanych raportów.
     * @returns {Promise<Array<{at: string, positions: Object, names: Object, guilds: Object, reconstructed?: boolean}>>}
     */
    async _loadHistory() {
        try {
            const data = await store.getOrLoad(this._historyFile, () => ({ reports: [] }));
            return Array.isArray(data?.reports) ? data.reports : [];
        } catch {
            return [];
        }
    }

    /**
     * Dopisuje jeden raport do historii i przycina ją do okna wykresu.
     *
     * ⚠️ Zapisujemy też NICKI i serwery, nie same pozycje. Gracz może zniknąć z rankingu
     * albo skasować profil, a wykres sprzed dwóch miesięcy ma nadal wiedzieć, kogo rysuje —
     * odtworzenie nazwy z bieżącego rankingu dałoby dla takiej osoby puste miejsce w legendzie.
     */
    async _appendHistory(top10, at = new Date()) {
        const reports = await this._loadHistory();

        const entry = { at: at.toISOString(), positions: {}, names: {}, guilds: {} };
        top10.forEach((p, i) => {
            const key = p.playerKey || p.userId;
            entry.positions[key] = i + 1;
            if (p.username) entry.names[key] = p.username;
            if (p.sourceGuildId) entry.guilds[key] = p.sourceGuildId;
        });

        // Wpis o tym samym znaczniku czasu zastępuje poprzedni — ponowne odtworzenie
        // historii nie ma mnożyć punktów na osi
        const bez = reports.filter(r => r.at !== entry.at);
        bez.push(entry);
        bez.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

        const granica = Date.now() - CHART_WINDOW_DAYS * 24 * 60 * 60 * 1000;
        const przyciete = bez.filter(r => Date.parse(r.at) >= granica).slice(-MAX_HISTORY_REPORTS);

        await store.set(this._historyFile, { reports: przyciete });
        return przyciete;
    }

    /**
     * Terminy WCZEŚNIEJSZYCH raportów, odtworzone wstecz z harmonogramu.
     *
     * Harmonogram jest deterministyczny (9 raportów co 3 dni, potem 4 dni przerwy), więc
     * z `nextTrigger` i `triggerCount` da się cofnąć krok po kroku. ⚠️ Działa tylko dopóki
     * harmonogram nie był po drodze przestawiany — `setSchedule()` zeruje `triggerCount`,
     * a wtedy cofanie odtworzy terminy, których nigdy nie było.
     * @param {number} ile ile terminów wstecz
     * @returns {Date[]} rosnąco
     */
    _pastReportTimes(ile) {
        if (!this._cfg?.nextTrigger) return [];

        const out = [];
        let t = new Date(this._cfg.nextTrigger).getTime();
        let numer = this._cfg.triggerCount || 0;

        for (let i = 0; i < ile && numer > 0; i++) {
            // `_stepOnce` dodało interwał liczony na numerze raportu, który właśnie poszedł
            const interwal = numer % CYCLE_LEN === 0 ? BREAK_INTERVAL_MS : REPORT_INTERVAL_MS;
            t -= interwal;
            numer -= 1;
            if (t <= 0) break;
            out.push(new Date(t));
        }

        return out.reverse();
    }

    // ── schedule management ────────────────────────────────────────────────────

    /**
     * Ustawia harmonogram. Wywoływane z panelu admina. Podana data to zawsze początek
     * cyklu (pierwszy boss sezonu, triggerCount=0).
     *
     * Jeśli podana data jest tożsama z aktualnie zapisanym `nextTrigger` — nic się nie zmienia
     * (zapobiega przypadkowemu wyzerowaniu pozycji w cyklu przy samym otwarciu i zatwierdzeniu
     * modala bez faktycznej zmiany daty).
     * Jeśli podana data jest w przeszłości — traktowana jest jako punkt odniesienia (np. faktyczny
     * początek sezonu) i harmonogram jest przewijany wg wzorca 9×3 dni + 4 dni przerwy do najbliższego
     * przyszłego terminu, bez wysyłania pominiętych po drodze raportów.
     * @param {string} firstTriggerIso  ISO string początku cyklu (może być w przeszłości)
     */
    setSchedule(firstTriggerIso) {
        if (this._cfg.enabled && this._cfg.nextTrigger === firstTriggerIso && this._cfg.triggerCount === 0) {
            logger.info('[GlobalTop10] Harmonogram bez zmian — pomijam reset cyklu');
            return;
        }

        this._cfg.enabled      = true;
        this._cfg.firstTrigger = firstTriggerIso;
        this._cfg.nextTrigger  = firstTriggerIso;
        this._cfg.triggerCount = 0;

        let skipped = 0;
        while (new Date(this._cfg.nextTrigger).getTime() <= Date.now()) {
            this._stepOnce();
            skipped++;
        }

        this._save();
        logger.info(`[GlobalTop10] Harmonogram ustawiony: początek cyklu ${firstTriggerIso}, kolejny raport ${this._cfg.nextTrigger} (pominięto ${skipped} zaległych, triggerCount=${this._cfg.triggerCount})`);
    }

    disableSchedule() {
        this._cfg.enabled = false;
        this._save();
        logger.info('[GlobalTop10] Harmonogram wyłączony');
    }

    _nextIntervalMs() {
        // Interwał PO bieżącym raporcie — liczony na numerze raportu, jaki właśnie zostanie/został
        // wysłany (triggerCount+1, zgodnie z _stepOnce, który inkrementuje przed obliczeniem).
        // Przerwa następuje po KAŻDYM 9. raporcie sezonu (numer podzielny przez CYCLE_LEN=9),
        // nie po co 10. — inaczej sezon dostawałby dodatkowy raport i przesuwał harmonogram.
        const reportNumber = (this._cfg.triggerCount || 0) + 1;
        return reportNumber % CYCLE_LEN === 0 ? BREAK_INTERVAL_MS : REPORT_INTERVAL_MS;
    }

    /**
     * Jeden krok postępu harmonogramu (inkrementacja triggerCount + przesunięcie nextTrigger
     * o właściwy interwał). Używane zarówno przez realny tick (_advanceTrigger), jak i przez
     * przewijanie zaległych terminów w setSchedule() — bez zapisu do pliku (save robi wywołujący).
     */
    _stepOnce() {
        const intervalMs = this._nextIntervalMs();
        this._cfg.triggerCount = (this._cfg.triggerCount || 0) + 1;
        const now = new Date(this._cfg.nextTrigger || Date.now());
        this._cfg.nextTrigger = new Date(now.getTime() + intervalMs).toISOString();
    }

    _advanceTrigger() {
        this._stepOnce();
        this._save();
    }

    // ── scheduler ─────────────────────────────────────────────────────────────

    start() {
        this._load();
        // Zasianie historii wstecz — bez await, start bota nie ma na to czekać
        this._seedHistoryOnce().catch(() => {});
        this._timer = setInterval(() => this._tick(), CHECK_INTERVAL_MS);
        logger.info(`[GlobalTop10] Scheduler uruchomiony (${this._cfg.enabled ? `następny: ${this._cfg.nextTrigger}` : 'wyłączony'})`);
    }

    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
    }

    async _tick() {
        if (!this._cfg?.enabled || !this._cfg.nextTrigger) return;
        if (!this.client?.isReady()) return;

        const now  = Date.now();
        const next = new Date(this._cfg.nextTrigger).getTime();
        if (now < next) return;

        // ⚠️ `setInterval` nie czeka na zakończenie poprzedniego przebiegu, a `_sendReports()`
        // wysyła embed na KAŻDY skonfigurowany serwer — przy większej liczbie serwerów
        // i rate limicie Discorda potrafi przekroczyć minutę. Bez tej blokady kolejny tick
        // widział wciąż nieprzesunięty `nextTrigger` i rozsyłał cały raport TOP10 po raz drugi.
        if (this._wysylkaWToku) {
            logger.warn('[GlobalTop10] Poprzednia wysyłka wciąż trwa - pomijam ten cykl');
            return;
        }
        this._wysylkaWToku = true;

        logger.info('[GlobalTop10] Czas raportu TOP10 — generuję…');
        try {
            await this._sendReports();
        } catch (err) {
            logger.error(`[GlobalTop10] Błąd wysyłania raportu: ${err.message}`);
        } finally {
            this._advanceTrigger();
            this._wysylkaWToku = false;
        }
    }

    // ── report generation ─────────────────────────────────────────────────────

    async _sendReports() {
        const guilds = this.guildConfigService.getAllConfiguredGuilds()
            .filter(g => g.globalTopNotifications !== false)
            .filter(g => this.client.guilds.cache.has(g.id));

        if (guilds.length === 0) {
            logger.info('[GlobalTop10] Brak serwerów z włączonymi powiadomieniami');
            return;
        }

        const globalRanking = await this.rankingService.getGlobalRanking(
            new Set(this.client.guilds.cache.keys())
        );
        const top10 = globalRanking.slice(0, 10);
        const bossName = await this._getMostFrequentBoss(10);
        const lastSnapshot = this._cfg.lastSnapshot || {};

        // Historia pozycji musi znać DOKŁADNIE tę kolejność, którą za chwilę wyślemy —
        // inaczej wiersz „na tej pozycji od" pokazałby czas liczony dla innego układu rankingu
        await this.positionHistoryService?.sync(globalRanking).catch(() => {});

        // Zaktualizuj snapshot przed wysłaniem
        const newSnapshot = {};
        top10.forEach((p, i) => { newSnapshot[p.playerKey || p.userId] = i + 1; });
        this._cfg.lastSnapshot = newSnapshot;
        this._save();

        // Dopisz ten raport do historii — to ona, a nie snapshot, żywi wykres zmian pozycji
        const historia = await this._appendHistory(top10).catch(err => {
            logger.warn(`[GlobalTop10] Nie udało się zapisać historii raportu: ${err.message}`);
            return null;
        });

        // Wykres rysujemy RAZ, bufor idzie na wszystkie serwery
        const wykres = await this._buildPositionChart(historia).catch(() => null);

        const sent = [], failed = [];
        const sentMessages = [];

        for (const guildCfg of guilds) {
            try {
                const channel = await this.client.channels.fetch(guildCfg.allowedChannelId);
                if (!channel) continue;

                const msgs = this.config.getMessages(guildCfg.id);
                const embed = await this._buildTop10Embed(
                    top10, lastSnapshot, bossName, msgs, guildCfg, this.client
                );

                // AttachmentBuilder budowany osobno na każdą wysyłkę — jednego nie da się
                // wysłać dwa razy, a ten sam wykres leci na każdy serwer
                const files = wykres ? [new AttachmentBuilder(wykres, { name: CHART_FILE })] : [];
                if (wykres) embed.setImage(`attachment://${CHART_FILE}`);

                const msg = await channel.send({ embeds: [embed], files });
                sentMessages.push({ guildId: guildCfg.id, channelId: channel.id, messageId: msg.id });
                sent.push(guildCfg.tag || guildCfg.id);
            } catch (err) {
                failed.push(`${guildCfg.tag || guildCfg.id} (${err.message})`);
            }
        }

        // Raport idzie na wszystkie serwery naraz, więc traktujemy go jak każde inne
        // rozgłoszenie: kopie rejestrujemy razem, żeby reakcje sumowały się cross-server
        await this.broadcastReactionService?.register('global_top10', sentMessages).catch(() => {});

        if (sent.length)   logger.info(`[GlobalTop10] Wysłano: ${sent.join(', ')}`);
        if (failed.length) logger.warn(`[GlobalTop10] Błędy: ${failed.join(', ')}`);
    }

    async _buildTop10Embed(top10, lastSnapshot, bossName, msgs, guildCfg, client) {
        const guildTagMap = new Map(this.config.getAllGuilds().map(g => [g.id, g.tag || null]));
        const medals      = ['👑', '🥈', '🥉'];
        const top1Score   = top10[0]?.scoreValue || 1;

        let lines = '';
        for (let i = 0; i < top10.length; i++) {
            const player   = top10[i];
            const position = i + 1;
            const prevPos  = lastSnapshot[player.playerKey || player.userId] || null;

            // Zmiana pozycji
            let changeStr, changeSign;
            if (!prevPos) {
                changeStr  = '🆕';
                changeSign = null;
            } else if (prevPos === position) {
                changeStr  = '`=`';
                changeSign = 'eq';
            } else if (prevPos > position) {
                const diff = prevPos - position;
                changeStr  = `**▲ +${diff}**`;
                changeSign = 'up';
            } else {
                const diff = position - prevPos;
                changeStr  = `**▼ −${diff}**`;
                changeSign = 'down';
            }

            // Nick (pobieramy z Discord)
            let displayName = player.username || `ID:${player.userId}`;
            try {
                const guildObj = client.guilds.cache.get(player.sourceGuildId);
                if (guildObj) {
                    const member = await guildObj.members.fetch(player.userId).catch(() => null);
                    if (member) displayName = member.displayName;
                }
            } catch { /* fallback na username */ }
            // Profil dodatkowy → nick + znacznik (② / ③)
            displayName = formatProfileDisplayName(displayName, player.profileIndex || getProfileIndex(player.playerKey));

            const tag       = guildTagMap.get(player.sourceGuildId);
            const date      = new Date(player.timestamp);
            const shortDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}`;
            const tagSuffix = tag ? `  ·  ${tag.replace(/^<a?:([^:]+):\d+>$/, '$1')}` : '';
            const scoreStr  = player.score || this.rankingService.formatScore(player.scoreValue);
            // Nazwa bossa w monospace — odcina ją od reszty wiersza, w którym sąsiaduje
            // ze wskaźnikiem zmiany, datą i tagiem serwera
            const bossStr   = `\`${player.bossName || msgs.unknownBoss}\``;

            // Trzeci wiersz — jak długo gracz siedzi na tej pozycji
            const holdLine = this._formatHoldLine(player.playerKey || player.userId, position, msgs);
            const holdStr  = holdLine ? `> ${holdLine}\n` : '';

            if (position <= 3) {
                // TOP 3 — blok z blockquote
                lines += `\`${String(position).padStart(2, '0')}\` ${medals[i]}  **${displayName}**  ·  **${scoreStr}**\n`;
                lines += `> ${changeStr}  ·  ${bossStr}  ·  *${shortDate}*${tagSuffix}\n${holdStr}\n`;
            } else {
                // 4–10 — dwie linie, zmiana pozycji w 2. wierszu
                lines += `\`${String(position).padStart(2, '0')}\`  **${displayName}**  ·  **${scoreStr}**\n`;
                lines += `> ${changeStr}  ·  ${bossStr}  ·  *${shortDate}*${tagSuffix}\n${holdStr}\n`;
            }
        }

        const nextIntervalDays = Math.round(this._nextIntervalMs() / (24 * 60 * 60 * 1000));

        const embed = new EmbedBuilder()
            .setColor(0xe74c3c)
            .setAuthor({
                name:    (msgs.globalTop10ReportTitle || '🌐 TOP 10 Globalny').replace(/^🌐\s*/, ''),
                iconURL: 'https://cdn.discordapp.com/emojis/1521275407322845325.webp?size=128',
            })
            .setDescription(lines || msgs.rankingEmpty)
            .addFields({
                name:   msgs.globalTop10BossField || '⚔️ Boss okresu',
                value:  bossName || msgs.unknownBoss,
                inline: true,
            })
            .setTimestamp()
            .setFooter({
                text: formatMessage(msgs.globalTop10FooterNext || 'Next report in {days} days', { days: nextIntervalDays }),
            });

        // Hall of Fame miejsca #1 — na samym dole, pod bossem okresu
        const hallField = await this._buildTop1HallField(msgs, client, guildTagMap);
        if (hallField) embed.addFields(hallField);

        const botIconUrl = this.client?.user?.displayAvatarURL({ size: 128 });
        if (botIconUrl) embed.setThumbnail(botIconUrl);

        return embed;
    }

    /**
     * Zasiewa historię raportów wstecz — JEDNORAZOWO, gdy plik jest jeszcze pusty.
     *
     * Bez tego wykres byłby pusty przez pierwsze ~3 miesiące po wdrożeniu (potrzebuje dwóch
     * ogłoszeń, a te idą co 3 dni). Terminy bierzemy z harmonogramu (`_pastReportTimes`),
     * a pozycje z odtworzenia historii wyników.
     *
     * ⚠️ Punkty odtworzone są PRZYBLIŻENIEM — nie biorą udziału gracze, którzy od tamtej pory
     * wypadli z rankingu. Prawdziwe ogłoszenia dopisywane od teraz są dokładne i z czasem
     * wypchną odtworzone poza okno wykresu.
     */
    async _seedHistoryOnce() {
        try {
            const istniejaca = await this._loadHistory();
            if (istniejaca.length > 0) return false; // już jest z czego rysować

            const ile = Math.ceil(CHART_WINDOW_DAYS / 3);
            const terminy = this._pastReportTimes(ile)
                .filter(d => d.getTime() >= Date.now() - CHART_WINDOW_DAYS * 24 * 60 * 60 * 1000);
            if (terminy.length < 2) return false;

            const { reconstructTop10At } = require('../backfill-position-history');
            const punkty = reconstructTop10At(terminy);
            if (punkty.length < 2) return false;

            await store.set(this._historyFile, { reports: punkty.slice(-MAX_HISTORY_REPORTS) });
            logger.info(`[GlobalTop10] Odtworzono historię ${punkty.length} raportów do wykresu zmian pozycji (wartości przybliżone)`);
            return true;
        } catch (err) {
            logger.warn(`[GlobalTop10] Nie udało się odtworzyć historii raportów: ${err.message}`);
            return false;
        }
    }

    /**
     * Buduje wykres zmian pozycji z historii raportów.
     * Zwraca null, gdy wykres nie ma sensu (brak generatora, mniej niż dwa raporty)
     * albo gdy renderowanie padnie — embed idzie wtedy bez obrazka, bez błędu dla graczy.
     * @param {Array|null} historia
     * @param {string} [lang] język podpisów wypalanych w bitmapę
     * @returns {Promise<Buffer|null>}
     */
    async _buildPositionChart(historia, lang = 'pol') {
        if (!this.chartService?.generateTop10PositionChart) return null;
        const reports = historia || await this._loadHistory();
        if (!Array.isArray(reports) || reports.length < 2) return null;

        try {
            return await this.chartService.generateTop10PositionChart(reports, { lang });
        } catch (err) {
            logger.warn(`[GlobalTop10] Nie udało się wygenerować wykresu pozycji: ${err.message}`);
            return null;
        }
    }

    /**
     * Wiersz „na tej pozycji od" pod graczem.
     * Gdy historia nie zna jeszcze gracza (pierwszy raport po wdrożeniu, świeży wpis w rankingu)
     * albo zapamiętana pozycja rozjechała się z tą wysyłaną — pokazujemy „nowa pozycja"
     * zamiast czasu, który byłby po prostu nieprawdziwy.
     * @returns {string|null} null = serwis historii niepodpięty, wiersz pomijany
     */
    _formatHoldLine(playerKey, position, msgs) {
        if (!this.positionHistoryService) return null;
        const stats = this.positionHistoryService.getPlayerStats(playerKey);
        if (!stats || stats.position !== position || stats.holdMs === null) {
            return msgs.globalTop10HoldingNew || 'Nowa pozycja';
        }
        // Czas w monospace — ten sam zapis co w polu „Najdłużej na 1. miejscu", żeby oba
        // czasy w embedzie czytało się jako tę samą wielkość, a nie dwie różne rzeczy
        return formatMessage(msgs.globalTop10HoldingFor || '{duration} na tej pozycji', {
            duration: `\`${GlobalPositionHistoryService.formatDuration(stats.holdMs)}\``,
        });
    }

    /**
     * Pole „Najdłużej na 1. miejscu" — TOP 3 wg łącznego czasu spędzonego na szczycie
     * rankingu globalnego (również gracze, którzy dawno z niego zeszli).
     * @param {Map<string, string|null>} guildTagMap - tagi serwerów, ten sam zestaw co w wierszach TOP 10
     * @returns {Promise<{name: string, value: string, inline: boolean}|null>}
     */
    async _buildTop1HallField(msgs, client, guildTagMap) {
        if (!this.positionHistoryService) return null;
        const hall = this.positionHistoryService.getTop1Leaderboard(3);
        if (hall.length === 0) return null;

        const medals = ['🥇', '🥈', '🥉'];
        const lines  = [];
        for (let i = 0; i < hall.length; i++) {
            const entry = hall[i];
            let name = entry.username || `ID:${entry.playerKey}`;
            try {
                const guildObj = entry.guildId ? client?.guilds?.cache?.get(entry.guildId) : null;
                if (guildObj) {
                    const member = await guildObj.members.fetch(getOwnerId(entry.playerKey)).catch(() => null);
                    if (member) name = member.displayName;
                }
            } catch { /* fallback na zapamiętany nick */ }
            name = formatProfileDisplayName(name, entry.profileIndex);
            // 👑 = gracz siedzi na szczycie w tej chwili, jego licznik wciąż rośnie
            const crown = entry.isCurrent ? ' 👑' : '';
            // Tag serwera pochodzenia — ten sam zapis co w wierszach TOP 10 (składnia emoji
            // rozbierana do samej nazwy). `guildId` bierzemy z historii, bo gracz mógł już
            // z rankingu wypaść i nie ma go w wysyłanej dziesiątce.
            const tag = guildTagMap?.get(entry.guildId);
            const tagSuffix = tag ? `  ·  ${tag.replace(/^<a?:([^:]+):\d+>$/, '$1')}` : '';
            lines.push(`${medals[i]} **${name}**${crown}${tagSuffix}  ·  \`${GlobalPositionHistoryService.formatDuration(entry.totalMs)}\``);
        }

        // Bez tego przypisu liczby wyglądają na przypadkowe — gracz, który stał na szczycie
        // przez pół roku, widzi u siebie kilka tygodni i nie ma jak się domyślić dlaczego
        // Format ISO (RRRR-MM-DD), a nie lokalny: `01.05.2026` czyta się na serwerze
        // angielskim jako 5 stycznia, a embed nie niesie ze sobą języka odbiorcy
        const odKiedy = new Date(GlobalPositionHistoryService.TOP1_COUNT_FROM).toISOString().slice(0, 10);
        const przypis = formatMessage(
            msgs.globalTop10Top1HallSince || '-# Liczone od {date}',
            { date: odKiedy }
        );

        return {
            name:   msgs.globalTop10Top1HallField || '⌛ Najdłużej na 1. miejscu',
            value:  `${lines.join('\n')}\n${przypis}`,
            inline: false,
        };
    }

    /**
     * Generuje embed TOP 10 na żądanie (komenda /generate).
     *
     * Podgląd pokazuje PRAWDZIWY stan rankingu: wskaźniki ▲▼=🆕 liczone są względem
     * snapshootu z OSTATNIEGO wysłanego raportu (`lastSnapshot`), a czasy „na tej pozycji od"
     * wprost z historii pozycji. Wcześniej snapshot był losowany, żeby pokazać wszystkie typy
     * wskaźników naraz — przez co podgląd nie odpowiadał na jedyne pytanie, po które się go
     * otwiera: jak będzie wyglądał najbliższy raport.
     *
     * Nie aktualizuje snapshootu ani harmonogramu — kolejny cykliczny raport dalej porówna
     * się z tym samym punktem odniesienia.
     */
    async buildOnDemandEmbed(msgs, client) {
        const globalRanking = await this.rankingService.getGlobalRanking(
            new Set(client.guilds.cache.keys())
        );
        const top10    = globalRanking.slice(0, 10);
        const bossName = await this._getMostFrequentBoss(10);

        // Czasy „na tej pozycji od" mają odpowiadać kolejności, którą podgląd właśnie pokazuje
        await this.positionHistoryService?.sync(globalRanking).catch(() => {});

        // Punkt odniesienia ten sam co w cyklicznym raporcie. Gdy raport nie poszedł jeszcze
        // ani razu (albo harmonogram dopiero ustawiono), snapshot jest pusty — wtedy wszyscy
        // dostają 🆕 i to jest uczciwe: nie ma się do czego porównać.
        const lastSnapshot = this._cfg?.lastSnapshot || {};

        const embed = await this._buildTop10Embed(top10, lastSnapshot, bossName, msgs, null, client);

        // Podgląd pokazuje ten sam wykres co realny raport — ale go NIE dopisuje do historii,
        // bo nie jest ogłoszeniem i nie może dołożyć punktu na osi
        const wykres = await this._buildPositionChart(null).catch(() => null);
        if (wykres) embed.setImage(`attachment://${CHART_FILE}`);

        return { embed, chart: wykres, chartFile: CHART_FILE };
    }

    // ── most frequent boss ─────────────────────────────────────────────────────

    async _getMostFrequentBoss(limit = 10) {
        const allEntries = [];
        const guildsDir  = path.join(this.dataDir, 'guilds');

        if (fs.existsSync(guildsDir)) {
            for (const guildDir of fs.readdirSync(guildsDir)) {
                const wDir = path.join(guildsDir, guildDir, 'wyniki');
                if (!fs.existsSync(wDir)) continue;
                for (const file of fs.readdirSync(wDir)) {
                    if (!file.endsWith('.json')) continue;
                    try {
                        const entries = store.getSync(path.join(wDir, file), () => ([]));
                        if (Array.isArray(entries)) allEntries.push(...entries);
                    } catch { /* skip */ }
                }
            }
        }

        // Stara lokalizacja wyniki/
        const oldWDir = path.join(this.dataDir, 'wyniki');
        if (fs.existsSync(oldWDir)) {
            for (const file of fs.readdirSync(oldWDir)) {
                if (!file.endsWith('.json')) continue;
                try {
                    const entries = store.getSync(path.join(oldWDir, file), () => ([]));
                    if (Array.isArray(entries)) allEntries.push(...entries);
                } catch { /* skip */ }
            }
        }

        // Bierzemy ostatnie `limit` wpisów (po timestamp desc)
        allEntries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        const recent = allEntries.slice(0, limit);

        const freq = {};
        for (const e of recent) {
            if (e.bossName) freq[e.bossName] = (freq[e.bossName] || 0) + 1;
        }

        if (Object.keys(freq).length === 0) return null;
        return Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
    }

    // ── snippet po nowym rekordzie ─────────────────────────────────────────────

    /**
     * Buduje dane snippetu (awans w globalnym rankingu).
     * Zwraca { title, description } lub null jeśli brak zmiany pozycji.
     */
    async buildSnippetFieldData(playerKey, newGlobalRanking, prevGlobalPosition, msgs, client) {
        const newGlobalIndex = newGlobalRanking.findIndex(p => (p.playerKey || p.userId) === playerKey);
        if (newGlobalIndex === -1) return null;
        const newGlobalPosition = newGlobalIndex + 1;

        if (prevGlobalPosition === newGlobalPosition) return null;

        const guildTagMap = new Map(this.config.getAllGuilds().map(g => [g.id, g.tag || null]));
        const medals = ['🥇', '🥈', '🥉'];

        const buildLine = async (player, position) => {
            const posLabel = position <= 3 ? medals[position - 1] : `**${position}.**`;
            let displayName = player.username || `ID:${player.userId}`;
            try {
                const guildObj = client.guilds.cache.get(player.sourceGuildId);
                if (guildObj) {
                    const member = await guildObj.members.fetch(player.userId).catch(() => null);
                    if (member) displayName = member.displayName;
                }
            } catch { /* fallback */ }
            displayName = formatProfileDisplayName(displayName, player.profileIndex || getProfileIndex(player.playerKey));
            const tag = guildTagMap.get(player.sourceGuildId);
            const date = new Date(player.timestamp);
            const shortDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}`;
            const serverSuffix = tag ? ` • ${tag.replace(/^<a?:([^:]+):\d+>$/, '$1')}` : '';
            return `${posLabel} ${displayName} • **${player.score || this.rankingService.formatScore(player.scoreValue)}**\n*(${shortDate})* • ${player.bossName || msgs.unknownBoss}${serverSuffix}`;
        };

        const prevLabel = prevGlobalPosition ? `#${prevGlobalPosition}` : '—';
        const direction = !prevGlobalPosition || prevGlobalPosition > newGlobalPosition ? '↑' : '↓';
        const title = msgs.globalSnippetTitle || '🌐 Zmiana w globalnym rankingu';

        const lines = [];
        const above = newGlobalRanking[newGlobalIndex - 1];
        const current = newGlobalRanking[newGlobalIndex];
        const below = newGlobalRanking[newGlobalIndex + 1];

        if (above)   lines.push(await buildLine(above, newGlobalPosition - 1));

        // Środkowa linia — oznaczona strzałką kierunku zmiany pozycji
        let currentLine = await buildLine(current, newGlobalPosition);
        currentLine = `${direction} ${currentLine}`;
        lines.push(currentLine);

        if (below) {
            // Gracz poniżej nowej pozycji został wypchnięty w przeciwnym kierunku
            const belowDirection = direction === '↑' ? '↓' : '↑';
            lines.push(`${belowDirection} ${await buildLine(below, newGlobalPosition + 1)}`);
        }

        return {
            title,
            newGlobalPosition,
            description: `**${msgs.snippetPositionChange || 'Zmiana pozycji:'}** ${direction} ${prevLabel} → #${newGlobalPosition}\n\n${lines.join('\n\n')}`
        };
    }

    /**
     * Snippet dla rankingu konkretnego bossa (identyczny format jak globalny).
     * @param {string} playerKey
     * @param {Array} bossRanking  - wynik getGlobalBossRanking (już po aktualizacji)
     * @param {number|null} prevBossPosition - pozycja przed aktualizacją (null = nowy wpis)
     * @param {string} bossName
     * @param {object} msgs
     * @param {object} client
     * @returns {{ title, description }|null}
     */
    async buildBossSnippetFieldData(playerKey, bossRanking, prevBossPosition, bossName, msgs, client) {
        const newBossIndex = bossRanking.findIndex(p => (p.playerKey || p.userId) === playerKey);
        if (newBossIndex === -1) return null;
        const newBossPosition = newBossIndex + 1;

        if (prevBossPosition !== null && prevBossPosition === newBossPosition) return null;

        const guildTagMap = new Map(this.config.getAllGuilds().map(g => [g.id, g.tag || null]));
        const medals = ['🥇', '🥈', '🥉'];

        const buildLine = async (player, position) => {
            const posLabel = position <= 3 ? medals[position - 1] : `**${position}.**`;
            let displayName = player.username || `ID:${player.userId}`;
            try {
                const guildObj = client.guilds.cache.get(player.sourceGuildId);
                if (guildObj) {
                    const member = await guildObj.members.fetch(player.userId).catch(() => null);
                    if (member) displayName = member.displayName;
                }
            } catch { /* fallback */ }
            displayName = formatProfileDisplayName(displayName, player.profileIndex || getProfileIndex(player.playerKey));
            const tag = guildTagMap.get(player.sourceGuildId);
            const date = new Date(player.timestamp);
            const shortDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}`;
            const serverSuffix = tag ? ` • ${tag.replace(/^<a?:([^:]+):\d+>$/, '$1')}` : '';
            return `${posLabel} ${displayName} • **${player.score || this.rankingService.formatScore(player.scoreValue)}**\n*(${shortDate})* • ${bossName}${serverSuffix}`;
        };

        const prevLabel = prevBossPosition ? `#${prevBossPosition}` : '—';
        const direction = !prevBossPosition || prevBossPosition > newBossPosition ? '↑' : '↓';
        const title = msgs.bossSnippetTitle || '🎯 Zmiana w rankingu bossa';

        const lines = [];
        const above   = bossRanking[newBossIndex - 1];
        const current = bossRanking[newBossIndex];
        const below   = bossRanking[newBossIndex + 1];

        if (above) lines.push(await buildLine(above, newBossPosition - 1));

        let currentLine = await buildLine(current, newBossPosition);
        lines.push(`${direction} ${currentLine}`);

        if (below) {
            const belowDir = direction === '↑' ? '↓' : '↑';
            lines.push(`${belowDir} ${await buildLine(below, newBossPosition + 1)}`);
        }

        return { title, description: `**${msgs.snippetPositionChange || 'Zmiana pozycji:'}** ${direction} ${prevLabel} → #${newBossPosition}\n\n${lines.join('\n\n')}` };
    }

    /**
     * Buduje snippet embed (awans w globalnym rankingu).
     * Zwraca EmbedBuilder lub null jeśli brak zmiany pozycji.
     */
    async buildSnippetEmbed(playerKey, newGlobalRanking, prevGlobalPosition, msgs, client) {
        const data = await this.buildSnippetFieldData(playerKey, newGlobalRanking, prevGlobalPosition, msgs, client);
        if (!data) return null;

        return new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(data.title)
            .setDescription(data.description);
    }
}

module.exports = GlobalTop10Service;
