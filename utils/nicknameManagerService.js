const path = require('path');
const store = require('./jsonStore');
const { createBotLogger } = require('./consoleLogger');

const logger = createBotLogger('NicknameManager');

const MAX_DLUGOSC_NICKU = 32;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CENTRALNY MANAGER EFEKTÓW NA NICKACH
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Koordynuje efekty nakładane na nicki przez różne boty (klątwa z Konklawe, flaga
 * z Muteusza, korona MVP z Kontrolera) tak, żeby się nie pobiły i żeby użytkownik
 * zawsze wrócił do PRAWDZIWEGO nicku, a nie do pośredniego stanu.
 *
 * ─── DLACZEGO LISTA EFEKTÓW, A NIE JEDEN WPIS ─────────────────────────────
 * Wcześniej na użytkownika przypadał JEDEN wpis, a każdy efekt dostawał własny
 * `setTimeout`. Przy nakładaniu wychodziły z tego dwa błędy:
 *
 *   1. Klątwa 5 min + flaga nałożona minutę później: wpis klątwy był NADPISYWANY
 *      przez flagę, ale timer klątwy dalej tykał. Po pięciu minutach przywracał
 *      oryginalny nick i kasował wpis — flaga kończyła się minutę za wcześnie,
 *      a jej własny timer trafiał już na pustkę.
 *   2. Po restarcie bota efekty, którym zostało jeszcze trochę czasu, NIE dostawały
 *      nowych timerów (`restoreExpiredEffects` zajmowało się wyłącznie wygasłymi),
 *      więc ich nick nie wracał już nigdy.
 *
 * Teraz każdy użytkownik ma LISTĘ efektów, każdy z własnym `id` i czasem wygaśnięcia.
 * Zdjęcie jednego efektu nie kończy pozostałych — nick jest PRZELICZANY na nowo
 * z oryginału i tych efektów, które wciąż są aktywne.
 *
 * ─── KSZTAŁT DANYCH ───────────────────────────────────────────────────────
 *   userId -> {
 *     originalNickname,   // nick sprzed PIERWSZEGO efektu (null = używał nicku głównego)
 *     wasUsingMainNick,
 *     guildId, username,
 *     effects: [ { id, effectType, prefix, replaceWith, appliedAt, expiresAt, appliedBy } ]
 *   }
 *
 * `prefix` doklejany jest przed nick (klątwa, korona), `replaceWith` podmienia go
 * w całości (flagi). Gdy aktywnych efektów jest kilka, prefiksy nakładają się
 * w kolejności nałożenia, a ostatni `replaceWith` wygrywa z prefiksami.
 */
class NicknameManagerService {
    constructor() {
        // Singleton — kilka botów w jednym procesie musi dzielić ten sam stan
        if (NicknameManagerService.instance) {
            return NicknameManagerService.instance;
        }

        this.dataPath = path.join(__dirname, '../shared_data');
        this.activeEffectsFile = path.join(this.dataPath, 'active_nickname_effects.json');
        this.configFile = path.join(this.dataPath, 'nickname_manager_config.json');

        // userId -> wpis użytkownika (patrz opis kształtu wyżej)
        this.activeEffects = new Map();

        // `${userId}:${effectId}` -> timeout przywrócenia
        this._timery = new Map();

        this.config = {
            buildInitialDatabase: false,
            enableSnapshotting: false,
            monitorNicknameChanges: false,
            cleanupInterval: 24 * 60 * 60 * 1000,
            maxEffectDuration: 30 * 24 * 60 * 60 * 1000
        };

        NicknameManagerService.instance = this;
    }

    static EFFECTS = {
        CURSE: 'curse',        // Klątwa z Konklawe
        FLAG: 'flag',          // Flaga z Muteusz
        WEAKENED: 'weakened',  // Osłabienie Lucyfera (trwałe)
        INFERNAL: 'infernal'   // Piekielny Układ (Infernal Bargain)
    };

    static getInstance() {
        if (!NicknameManagerService.instance) {
            new NicknameManagerService();
        }
        return NicknameManagerService.instance;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  INICJALIZACJA I PERSISTENCJA
    // ═══════════════════════════════════════════════════════════════════════

    async initialize() {
        if (this._zainicjalizowany) return;
        this._zainicjalizowany = true;

        try {
            await this.loadConfig();
            await this.loadActiveEffects();
            this.startCleanupInterval();
            logger.info('✅ NicknameManager zainicjalizowany');
        } catch (error) {
            this._zainicjalizowany = false;
            logger.error('❌ Błąd inicjalizacji NicknameManager:', error);
            throw error;
        }
    }

    async loadConfig() {
        try {
            const zapisana = await store.getOrLoad(this.configFile, () => null);
            if (zapisana) {
                this.config = { ...this.config, ...zapisana };
            } else {
                await this.saveConfig();
                logger.info('📁 Utworzono domyślną konfigurację NicknameManager');
            }
        } catch (error) {
            logger.error('❌ Błąd ładowania konfiguracji:', error);
        }
    }

    async saveConfig() {
        try {
            await store.set(this.configFile, this.config);
        } catch (error) {
            logger.error('❌ Błąd zapisywania konfiguracji:', error);
        }
    }

    /**
     * Przerabia wpis ze starego kształtu (jeden efekt na użytkownika) na listę.
     * Stare pliki mają `effectType` bezpośrednio na wpisie użytkownika.
     */
    _zmigrujWpis(userId, dane) {
        if (Array.isArray(dane?.effects)) return dane;

        return {
            originalNickname: dane.originalNickname ?? null,
            wasUsingMainNick: dane.wasUsingMainNick ?? (dane.originalNickname == null),
            guildId: dane.guildId ?? null,
            username: dane.username ?? null,
            effects: dane.effectType ? [{
                id: `${userId}-migracja`,
                effectType: dane.effectType,
                prefix: dane.prefix ?? null,
                replaceWith: dane.replaceWith ?? null,
                appliedAt: dane.appliedAt ?? Date.now(),
                expiresAt: dane.expiresAt ?? null,
                appliedBy: dane.appliedBy ?? null
            }] : []
        };
    }

    async loadActiveEffects() {
        try {
            const zapisane = await store.getOrLoad(this.activeEffectsFile, () => ({}));

            this.activeEffects = new Map();
            for (const [userId, dane] of Object.entries(zapisane || {})) {
                const wpis = this._zmigrujWpis(userId, dane);
                if (wpis.effects.length > 0) this.activeEffects.set(userId, wpis);
            }

            const efektow = [...this.activeEffects.values()].reduce((s, w) => s + w.effects.length, 0);
            logger.info(`📂 Załadowano ${efektow} efektów dla ${this.activeEffects.size} użytkowników`);
        } catch (error) {
            logger.error('❌ Błąd ładowania efektów:', error);
            this.activeEffects = new Map();
        }
    }

    async persistActiveEffects() {
        try {
            await store.set(this.activeEffectsFile, Object.fromEntries(this.activeEffects));
        } catch (error) {
            logger.error('❌ Błąd zapisywania efektów:', error);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  NICKI — ODCZYT I SKŁADANIE
    // ═══════════════════════════════════════════════════════════════════════

    getCurrentServerNickname(member) {
        const nickname = member.nickname;
        if (!nickname) return null;

        // Czyścimy prefiksy, żeby drugi efekt nie zapisał jako "oryginalny" nicku
        // zmienionego już przez pierwszy
        return this.getCleanNickname(nickname);
    }

    isEffectNickname(nickname) {
        if (!nickname) return false;

        const prefiksy = [/^Przeklęty /, /^Osłabiony /, /^Uśpiony /, /^Oszołomiony /, /^Upadły /, /^Piekielny /];
        const flagi = [
            "Jebaty Ukrajinu!", "POLSKA GUROM!", "עם ישראל חי!",
            "American Dream", "Hände hoch!", "Cyka blyat!"
        ];

        return prefiksy.some(p => p.test(nickname)) || flagi.includes(nickname);
    }

    getCleanNickname(nickname) {
        if (!nickname) return nickname;

        return nickname
            .replace(/^Przeklęty /, '')
            .replace(/^Osłabiony /, '')
            .replace(/^Uśpiony /, '')
            .replace(/^Oszołomiony /, '')
            .replace(/^Upadły /, '')
            .replace(/^Piekielny /, '');
    }

    /** Efekty użytkownika, które jeszcze nie wygasły (bez efektów bezterminowych odfiltrowanych). */
    _aktywneEfekty(userId, teraz = Date.now()) {
        const wpis = this.activeEffects.get(userId);
        if (!wpis) return [];
        return wpis.effects.filter(e => e.expiresAt === null || e.expiresAt > teraz);
    }

    /**
     * Składa docelowy nick z oryginału i aktywnych efektów.
     * @returns {string|null} null = przywróć nick główny (brak nicku serwerowego)
     */
    _zlozNick(wpis, efekty) {
        // Gdy użytkownik nie miał nicku serwerowego, bazą jest jego nazwa użytkownika —
        // inaczej z prefiksu powstałby sam prefix ("Przeklęty" zamiast "Przeklęty Janusz")
        const bazowy = wpis.originalNickname ?? wpis.username ?? '';

        if (efekty.length === 0) {
            return wpis.wasUsingMainNick ? null : (wpis.originalNickname ?? null);
        }

        // Podmiana całości (flagi) wygrywa — bierzemy NAJPÓŹNIEJ nałożoną
        const podmiana = [...efekty].reverse().find(e => e.replaceWith);
        if (podmiana) return String(podmiana.replaceWith).substring(0, MAX_DLUGOSC_NICKU);

        const prefiksy = efekty.filter(e => e.prefix).map(e => String(e.prefix).trim());
        if (prefiksy.length === 0) {
            return wpis.wasUsingMainNick ? null : (wpis.originalNickname ?? null);
        }

        // Prefiksy w kolejności nałożenia: ostatni nałożony jest najbardziej z przodu
        const zlozony = `${prefiksy.reverse().join(' ')} ${bazowy}`.trim();
        return zlozony.substring(0, MAX_DLUGOSC_NICKU);
    }

    /**
     * Ustawia nick wynikający z aktualnego zestawu efektów. Gdy efektów już nie ma —
     * przywraca oryginał i kasuje wpis.
     */
    async _przeliczNick(userId, guild) {
        const wpis = this.activeEffects.get(userId);
        if (!wpis) return false;

        const efekty = this._aktywneEfekty(userId);
        const docelowy = this._zlozNick(wpis, efekty);

        try {
            const member = await guild.members.fetch(userId);

            if (!member.manageable) {
                logger.warn(`⚠️ Brak uprawnień do zmiany nicku ${member.user.tag} (wyższa rola lub właściciel)`);
                if (efekty.length === 0) {
                    this.activeEffects.delete(userId);
                    await this.persistActiveEffects();
                }
                return false;
            }

            await member.setNickname(docelowy);

            if (efekty.length === 0) {
                this._anulujTimeryUzytkownika(userId);
                this.activeEffects.delete(userId);
                logger.info(`🔄 Przywrócono nick ${member.user.tag}: ${docelowy === null ? '[nick główny]' : `"${docelowy}"`}`);
            } else {
                wpis.effects = efekty;
                const typy = efekty.map(e => e.effectType).join(' + ');
                logger.info(`🔁 Przeliczono nick ${member.user.tag} po zmianie efektów (${typy}): "${docelowy}"`);
            }

            await this.persistActiveEffects();
            return true;
        } catch (error) {
            logger.error(`❌ Błąd przeliczania nicku dla ${userId}: ${error.message}`);
            return false;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  ODCZYT STANU
    // ═══════════════════════════════════════════════════════════════════════

    hasActiveEffect(userId) {
        return this._aktywneEfekty(userId).length > 0;
    }

    hasEffectType(userId, effectType) {
        return this._aktywneEfekty(userId).some(e => e.effectType === effectType);
    }

    /** Typ NAJPÓŹNIEJ nałożonego aktywnego efektu (zgodność ze starym API). */
    getActiveEffectType(userId) {
        const efekty = this._aktywneEfekty(userId);
        return efekty.length > 0 ? efekty[efekty.length - 1].effectType : null;
    }

    getEffectInfo(userId) {
        const wpis = this.activeEffects.get(userId);
        const efekty = this._aktywneEfekty(userId);
        if (!wpis || efekty.length === 0) return null;

        const najnowszy = efekty[efekty.length - 1];
        return {
            effectType: najnowszy.effectType,
            appliedAt: najnowszy.appliedAt,
            expiresAt: najnowszy.expiresAt,
            originalNickname: wpis.originalNickname,
            wasUsingMainNick: wpis.wasUsingMainNick,
            effects: efekty.map(e => ({ ...e }))
        };
    }

    /**
     * Użytkownicy mający aktywny efekt danego typu.
     * @returns {Array<[string, Object]>} pary [userId, dane efektu + guildId]
     */
    getUsersWithEffectType(effectType) {
        const wynik = [];
        for (const [userId, wpis] of this.activeEffects.entries()) {
            const efekt = this._aktywneEfekty(userId).find(e => e.effectType === effectType);
            if (efekt) wynik.push([userId, { ...efekt, guildId: wpis.guildId, originalNickname: wpis.originalNickname }]);
        }
        return wynik;
    }

    getStats() {
        const stats = { totalActiveEffects: 0, uzytkownikow: this.activeEffects.size, curses: 0, flags: 0, weakened: 0, infernal: 0 };

        for (const userId of this.activeEffects.keys()) {
            for (const efekt of this._aktywneEfekty(userId)) {
                stats.totalActiveEffects++;
                if (efekt.effectType === NicknameManagerService.EFFECTS.CURSE) stats.curses++;
                else if (efekt.effectType === NicknameManagerService.EFFECTS.FLAG) stats.flags++;
                else if (efekt.effectType === NicknameManagerService.EFFECTS.WEAKENED) stats.weakened++;
                else if (efekt.effectType === NicknameManagerService.EFFECTS.INFERNAL) stats.infernal++;
            }
        }

        return stats;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  NAKŁADANIE EFEKTÓW
    // ═══════════════════════════════════════════════════════════════════════

    async validateEffectApplication(member, effectType) {
        if (!member.manageable) {
            return {
                canApply: false,
                reason: `Brak uprawnień do zmiany nicku ${member.user.tag} (wyższa rola lub właściciel serwera)`
            };
        }

        // ⚠️ ŚWIADOMIE bez ogólnej blokady "ten sam typ drugi raz". Konklawe używa typu
        // CURSE dla kilku różnych efektów (klątwa „Przeklęty", uśpienie „Uśpiony”), więc
        // taka reguła odcięłaby poprawne przypadki. Zachowujemy dokładnie starą semantykę:
        // blokujemy wyłącznie ponowną klątwę rozpoznaną po samym nicku.
        if (effectType === NicknameManagerService.EFFECTS.CURSE && member.displayName.startsWith('Przeklęty ')) {
            return { canApply: false, reason: 'Użytkownik ma już klątwę' };
        }

        return { canApply: true };
    }

    /**
     * Dopisuje efekt do listy użytkownika (bez dotykania nicku na Discordzie).
     *
     * @param {string} userId
     * @param {string} effectType
     * @param {GuildMember} member
     * @param {number} durationMs   `Infinity` albo `null` = efekt bezterminowy
     * @param {Object} [opcje]      { prefix, replaceWith, appliedBy }
     * @returns {Promise<Object>} dane dopisanego efektu
     */
    async saveOriginalNickname(userId, effectType, member, durationMs, opcje = {}) {
        const walidacja = await this.validateEffectApplication(member, effectType);
        if (!walidacja.canApply) {
            throw new Error(walidacja.reason);
        }

        let wpis = this.activeEffects.get(userId);

        if (!wpis) {
            // PIERWSZY efekt — dopiero teraz zapamiętujemy prawdziwy nick
            const originalNickname = this.getCurrentServerNickname(member);
            wpis = {
                originalNickname,
                wasUsingMainNick: originalNickname === null,
                guildId: member.guild.id,
                username: member.user.username,
                effects: []
            };
            this.activeEffects.set(userId, wpis);
            logger.info(`💾 Zapamiętano oryginalny nick ${member.user.tag}: "${originalNickname || '[nick główny]'}"`);
        } else {
            // Kolejny efekt NIE nadpisuje oryginału — nick bazowy zostaje ten z pierwszego
            logger.info(`🔄 Nakładanie efektu ${effectType} na ${wpis.effects.length} już aktywnych (oryginał: "${wpis.originalNickname || '[nick główny]'}")`);
        }

        const efekt = {
            id: `${userId}-${effectType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            effectType,
            prefix: opcje.prefix ?? null,
            replaceWith: opcje.replaceWith ?? null,
            appliedAt: Date.now(),
            expiresAt: (durationMs === Infinity || durationMs === null || durationMs === undefined)
                ? null
                : Date.now() + durationMs,
            appliedBy: opcje.appliedBy ?? null
        };

        wpis.effects.push(efekt);
        await this.persistActiveEffects();

        return efekt;
    }

    /**
     * Nakłada efekt: dopisuje go do listy, przelicza nick i ustawia timer przywrócenia.
     *
     * @param {number|null} durationMs null = bezterminowy
     * @param {string|null} prefix     np. 'Upadły', 'Piekielny', '👑'
     */
    async applyEffect(userId, effectType, durationMs, metadata = {}, member, prefix = null) {
        const efektPrefix = prefix || metadata.prefix || null;
        const czasTrwania = (durationMs === null || durationMs === undefined) ? Infinity : durationMs;

        const efekt = await this.saveOriginalNickname(userId, effectType, member, czasTrwania, {
            prefix: efektPrefix,
            replaceWith: metadata.replaceWith ?? metadata.flagEmoji ?? null,
            appliedBy: metadata.appliedBy ?? null
        });

        await this._przeliczNick(userId, member.guild);
        logger.info(`✅ Nałożono efekt ${effectType} na ${member.user.tag}`);

        if (efekt.expiresAt !== null) {
            this._zaplanujPrzywrocenie(userId, efekt, member.guild);
        }

        return efekt;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  ZDEJMOWANIE EFEKTÓW
    // ═══════════════════════════════════════════════════════════════════════

    _kluczTimera(userId, effectId) {
        return `${userId}:${effectId}`;
    }

    _zaplanujPrzywrocenie(userId, efekt, guild) {
        const klucz = this._kluczTimera(userId, efekt.id);
        this._anulujTimer(klucz);

        const zostalo = Math.max(0, efekt.expiresAt - Date.now());
        const timer = setTimeout(async () => {
            this._timery.delete(klucz);
            try {
                await this.removeEffectById(userId, efekt.id, guild);
            } catch (error) {
                logger.error(`❌ Błąd automatycznego zdejmowania efektu ${efekt.effectType}: ${error.message}`);
            }
        }, zostalo);

        this._timery.set(klucz, timer);
    }

    _anulujTimer(klucz) {
        const timer = this._timery.get(klucz);
        if (timer) {
            clearTimeout(timer);
            this._timery.delete(klucz);
        }
    }

    _anulujTimeryUzytkownika(userId) {
        for (const klucz of [...this._timery.keys()]) {
            if (klucz.startsWith(`${userId}:`)) this._anulujTimer(klucz);
        }
    }

    /**
     * Zdejmuje JEDEN efekt i przelicza nick z tych, które zostały.
     * To jest właściwa ścieżka wygaśnięcia pojedynczego efektu przy nakładaniu.
     */
    async removeEffectById(userId, effectId, guild) {
        const wpis = this.activeEffects.get(userId);
        if (!wpis) return false;

        const przed = wpis.effects.length;
        wpis.effects = wpis.effects.filter(e => e.id !== effectId);
        if (wpis.effects.length === przed) return false;

        this._anulujTimer(this._kluczTimera(userId, effectId));
        await this.persistActiveEffects();

        if (!guild) return true;
        return this._przeliczNick(userId, guild);
    }

    /** Zdejmuje wszystkie efekty danego typu i przelicza nick. */
    async removeEffectType(userId, effectType, guild) {
        const wpis = this.activeEffects.get(userId);
        if (!wpis) return false;

        const doZdjecia = wpis.effects.filter(e => e.effectType === effectType);
        if (doZdjecia.length === 0) return false;

        for (const efekt of doZdjecia) this._anulujTimer(this._kluczTimera(userId, efekt.id));
        wpis.effects = wpis.effects.filter(e => e.effectType !== effectType);
        await this.persistActiveEffects();

        if (!guild) return true;
        return this._przeliczNick(userId, guild);
    }

    /**
     * Zdejmuje WSZYSTKIE efekty użytkownika i przywraca oryginalny nick.
     */
    async restoreOriginalNickname(userId, guild) {
        const wpis = this.activeEffects.get(userId);
        if (!wpis) {
            logger.warn(`⚠️ Brak zapisanych efektów dla użytkownika ${userId}`);
            return false;
        }

        this._anulujTimeryUzytkownika(userId);
        wpis.effects = [];
        await this.persistActiveEffects();

        return this._przeliczNick(userId, guild);
    }

    async removeAllUserEffects(userId, guild) {
        return this.restoreOriginalNickname(userId, guild);
    }

    /**
     * Usuwa WPIS z ewidencji bez dotykania nicku na Discordzie.
     *
     * ⚠️ To NIE przywraca nicku i kasuje zapamiętany oryginał — po tym wywołaniu
     * nie ma już z czego przywracać. Do zdejmowania efektu używaj
     * `removeAllUserEffects(userId, guild)`, `removeEffectType()` albo `removeEffectById()`.
     */
    async removeEffect(userId) {
        if (!this.activeEffects.has(userId)) return false;

        this._anulujTimeryUzytkownika(userId);
        this.activeEffects.delete(userId);
        await this.persistActiveEffects();
        logger.info(`🗑️ Usunięto wpis efektów użytkownika ${userId} (bez zmiany nicku)`);
        return true;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  SPRZĄTANIE I ODTWARZANIE PO RESTARCIE
    // ═══════════════════════════════════════════════════════════════════════

    async cleanupExpiredEffects() {
        const teraz = Date.now();
        let usuniete = 0;

        for (const [userId, wpis] of [...this.activeEffects.entries()]) {
            const przed = wpis.effects.length;
            wpis.effects = wpis.effects.filter(e => e.expiresAt === null || e.expiresAt > teraz);
            usuniete += przed - wpis.effects.length;

            if (wpis.effects.length === 0) this.activeEffects.delete(userId);
        }

        if (usuniete > 0) {
            await this.persistActiveEffects();
            logger.info(`🧹 Wyczyszczono ${usuniete} wygasłych efektów`);
        }

        return usuniete;
    }

    /**
     * Po restarcie: zdejmuje efekty, które wygasły podczas przestoju, i UZBRAJA NA NOWO
     * timery tych, które jeszcze trwają.
     *
     * ⚠️ Druga część jest równie ważna jak pierwsza. Timery żyją wyłącznie w pamięci,
     * więc dawniej efekt, któremu przy restarcie zostało jeszcze trochę czasu, nie
     * dostawał już nigdy nowego timera — jego nick nie wracał do końca świata.
     */
    async restoreExpiredEffects(client) {
        try {
            await this.loadActiveEffects();

            const teraz = Date.now();
            let przywrocone = 0;
            let uzbrojone = 0;
            let bledy = 0;

            for (const [userId, wpis] of [...this.activeEffects.entries()]) {
                const wygasle = wpis.effects.filter(e => e.expiresAt !== null && e.expiresAt <= teraz);
                const trwajace = wpis.effects.filter(e => e.expiresAt === null || e.expiresAt > teraz);

                if (wygasle.length === 0 && trwajace.length === 0) {
                    this.activeEffects.delete(userId);
                    continue;
                }

                const guildId = wpis.guildId;
                let guild = null;
                try {
                    guild = guildId ? await client.guilds.fetch(guildId) : null;
                } catch {
                    guild = null;
                }

                if (!guild) {
                    logger.warn(`⚠️ Nie znaleziono serwera ${guildId} dla użytkownika ${userId}`);
                    bledy++;
                    continue;
                }

                if (wygasle.length > 0) {
                    wpis.effects = trwajace;
                    const ok = await this._przeliczNick(userId, guild);
                    if (ok) przywrocone += wygasle.length;
                    else bledy++;
                }

                // Uzbrój timery dla tych, które wciąż trwają
                for (const efekt of trwajace) {
                    if (efekt.expiresAt === null) continue;
                    this._zaplanujPrzywrocenie(userId, efekt, guild);
                    uzbrojone++;
                }
            }

            await this.persistActiveEffects();
            logger.info(`✅ Efekty po restarcie: zdjęto ${przywrocone} wygasłych, uzbrojono ${uzbrojone} trwających, błędów: ${bledy}`);

            return { restored: przywrocone, rearmed: uzbrojone, errors: bledy };
        } catch (error) {
            logger.error('❌ Błąd przywracania efektów po restarcie:', error);
            return { restored: 0, rearmed: 0, errors: 1 };
        }
    }

    startCleanupInterval() {
        // Idempotentne — singleton bywa inicjalizowany przez kilka botów w tym samym procesie
        if (this._cleanupIntervalId) return;

        this._cleanupIntervalId = setInterval(async () => {
            await this.cleanupExpiredEffects();
        }, this.config.cleanupInterval);
        this._cleanupIntervalId.unref?.();

        logger.info(`🔄 Uruchomiono automatyczne czyszczenie (co ${this.config.cleanupInterval / (60 * 1000)} minut)`);
    }

    async shutdown() {
        try {
            for (const klucz of [...this._timery.keys()]) this._anulujTimer(klucz);
            await this.persistActiveEffects();
            await this.saveConfig();
            logger.info('💾 NicknameManager - dane zapisane przed wyłączeniem');
        } catch (error) {
            logger.error('❌ Błąd podczas wyłączania NicknameManager:', error);
        }
    }
}

module.exports = NicknameManagerService;
