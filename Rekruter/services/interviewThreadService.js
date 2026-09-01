const { ChannelType } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Rekruter');

/** Prefiks nazwy wątku — po nim poznajemy własne wątki przy sprzątaniu po restarcie */
const PREFIKS_WATKU = 'rekrutacja-';
/** Nazwa wątku w Discordzie ma limit 100 znaków */
const LIMIT_NAZWY = 100;
/** Wątek porzucony archiwizuje się sam po godzinie */
const AUTO_ARCHIWIZACJA_MIN = 60;
/** Zwłoka przed skasowaniem wątku, żeby kandydat zdążył przeczytać ostatnią wiadomość */
const ZWLOKA_KASOWANIA_MS = 15_000;

/**
 * Prywatny wątek na rozmowę rekrutacyjną.
 *
 * Rozmowa toczy się normalnymi wiadomościami w wątku widocznym tylko dla kandydata
 * i administracji — zamiast w efemerycznej odpowiedzi, która żyła 15 minut, kasowała
 * wiadomości kandydata i wymagała sklejania transkrypcji, żeby w ogóle było widać,
 * o czym rozmawiano. Wątek jest kasowany po zakończeniu rekrutacji; trwały ślad zostaje
 * w archiwum (`interviewLogService`), które działa bez zmian.
 *
 * ⚠️ Mapa wątków żyje w pamięci, tak jak reszta stanu rekrutacji. Po restarcie bota żadna
 * rozmowa nie jest już w toku, więc każdy pozostały wątek rekrutacyjny to śmieć — sprząta
 * je `posprzataj()` wołane przy starcie.
 */
class InterviewThreadService {
    constructor() {
        // userId -> { watek, status }  (`status` = wiadomość edytowana przez adapter)
        this.watki = new Map();
    }

    /**
     * Zakłada prywatny wątek i wprowadza do niego kandydata.
     *
     * @returns {Promise<import('discord.js').ThreadChannel|null>} null, gdy się nie udało
     *          (brak uprawnienia, kanał nie jest tekstowy) — wołający musi to obsłużyć
     */
    async utworz(kanal, user) {
        if (!kanal || kanal.type !== ChannelType.GuildText) {
            logger.error('[WATEK] Kanał rekrutacyjny nie jest zwykłym kanałem tekstowym - nie da się założyć wątku');
            return null;
        }

        try {
            const watek = await kanal.threads.create({
                name: `${PREFIKS_WATKU}${user.username}`.slice(0, LIMIT_NAZWY),
                type: ChannelType.PrivateThread,
                // Bez tego każdy z dostępem do wątku mógłby dopraszać kolejne osoby
                invitable: false,
                autoArchiveDuration: AUTO_ARCHIWIZACJA_MIN,
                reason: `Rozmowa rekrutacyjna: ${user.username}`,
            });

            await watek.members.add(user.id);
            this.watki.set(user.id, { watek, status: null });

            logger.info(`[WATEK] Założono wątek rekrutacyjny dla ${user.username} (${watek.id})`);
            return watek;
        } catch (error) {
            logger.error(`[WATEK] Nie udało się założyć wątku dla ${user.username}: ${error.message}`);
            return null;
        }
    }

    pobierz(userId) {
        return this.watki.get(userId)?.watek || null;
    }

    /** Czy ta wiadomość przyszła z wątku rozmowy tego kandydata */
    czyWatekRozmowy(userId, channelId) {
        return this.watki.get(userId)?.watek?.id === channelId;
    }

    /**
     * Wypowiedź bota w rozmowie — zwykła, nowa wiadomość w wątku.
     *
     * Kasuje zapamiętaną wiadomość statusową: kolejny `editReply` ma trafić POD rozmowę,
     * a nie przerabiać coś, co przewinęło się już wyżej.
     */
    async wyslij(userId, tresc) {
        const wpis = this.watki.get(userId);
        if (!wpis) return false;

        try {
            await wpis.watek.send({ content: String(tresc).slice(0, 2000) });
            wpis.status = null;
            return true;
        } catch (error) {
            logger.error(`[WATEK] Nie udało się wysłać wiadomości do wątku: ${error.message}`);
            return false;
        }
    }

    /**
     * Zamiennik interakcji efemerycznej dla kodu, który po rozmowie pyta o zmianę nicku
     * albo pokazuje postęp OCR (`updateUserEphemeralReply` woła wyłącznie `editReply`).
     *
     * Pierwsze wywołanie wysyła nową wiadomość, kolejne ją edytują — dokładnie tak, jak
     * zachowywała się odpowiedź efemeryczna, więc tamten kod działa bez zmian.
     */
    adapterOdpowiedzi(userId) {
        return {
            editReply: async ({ content = '', components = [], files = [] } = {}) => {
                const wpis = this.watki.get(userId);
                if (!wpis) return;

                const tresc = { content, components, files };
                if (wpis.status) {
                    try {
                        await wpis.status.edit(tresc);
                        return;
                    } catch {
                        // Wiadomość mogła zniknąć — wysyłamy nową zamiast wywracać rekrutację
                        wpis.status = null;
                    }
                }
                wpis.status = await wpis.watek.send(tresc);
            },
        };
    }

    /**
     * Kasuje wątek. Domyślnie z kilkunastosekundową zwłoką, żeby kandydat zdążył
     * przeczytać ostatnią wiadomość.
     */
    async usun(userId, { natychmiast = false } = {}) {
        const wpis = this.watki.get(userId);
        if (!wpis) return;
        this.watki.delete(userId);

        const skasuj = async () => {
            try {
                await wpis.watek.delete('Rekrutacja zakończona');
                logger.info(`[WATEK] Skasowano wątek rekrutacyjny ${wpis.watek.id}`);
            } catch (error) {
                logger.warn(`[WATEK] Nie udało się skasować wątku ${wpis.watek.id}: ${error.message}`);
            }
        };

        if (natychmiast) {
            await skasuj();
            return;
        }
        setTimeout(() => { skasuj().catch(() => {}); }, ZWLOKA_KASOWANIA_MS);
    }

    /**
     * Sprząta wątki rekrutacyjne pozostałe po poprzednim uruchomieniu bota.
     *
     * ⚠️ Wołane przy starcie, gdy żadna rozmowa nie może być w toku (stan rekrutacji żyje
     * wyłącznie w pamięci) — każdy zastany wątek z naszym prefiksem jest więc śmieciem.
     */
    async posprzataj(kanaly) {
        let skasowane = 0;

        for (const kanal of kanaly.filter(Boolean)) {
            if (kanal.type !== ChannelType.GuildText) continue;

            try {
                const aktywne = await kanal.threads.fetchActive();
                const zarchiwizowane = await kanal.threads.fetchArchived({ type: 'private', fetchAll: true })
                    .catch(() => ({ threads: new Map() }));

                for (const watek of [...aktywne.threads.values(), ...zarchiwizowane.threads.values()]) {
                    if (!watek.name?.startsWith(PREFIKS_WATKU)) continue;
                    await watek.delete('Sprzątanie wątków rekrutacyjnych po restarcie').catch(() => {});
                    skasowane++;
                }
            } catch (error) {
                logger.warn(`[WATEK] Sprzątanie wątków na kanale ${kanal.id} nie powiodło się: ${error.message}`);
            }
        }

        if (skasowane > 0) logger.info(`[WATEK] Sprzątnięto ${skasowane} porzuconych wątków rekrutacyjnych`);
        return skasowane;
    }
}

module.exports = InterviewThreadService;
