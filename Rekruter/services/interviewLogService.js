const { AttachmentBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const fs = require('fs').promises;
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Rekruter');

/**
 * Archiwum rozmów rekrutacyjnych prowadzonych przez AI.
 *
 * Rozmowa toczy się w efemerycznej odpowiedzi widocznej WYŁĄCZNIE dla kandydata,
 * a jego wiadomości i zdjęcia są kasowane z kanału zaraz po odczytaniu – po całej
 * rekrutacji nie zostawał więc żaden ślad poza embedem podsumowania. Ten serwis
 * przepisuje przebieg rozmowy na osobny kanał: każdą wypowiedź obu stron, każde
 * przesłane zdjęcie (jako załącznik) i to, co bot z niego odczytał.
 *
 * Kanał podaje się zmienną `REKRUTER_INTERVIEW_LOG_CHANNEL`. Bez niej serwis jest
 * wyłączony i wszystkie metody są puste – reszta rekrutacji działa bez zmian.
 *
 * ⚠️ Kanał zobaczy komplet danych kandydata (nick, statystyki, treść rozmowy,
 * zrzuty ekranu), więc musi być widoczny wyłącznie dla administracji.
 */

/** Jedna wypowiedź nie zmieści się w wiadomości Discorda – dzielimy na kawałki */
const LIMIT_WIADOMOSCI = 1900;
/** Ile kawałka musi być zapełnione, żeby ciąć na spacji zamiast twardo na limicie */
const MINIMALNE_WYPELNIENIE = 0.6;
/** Nazwa wątku w Discordzie ma limit 100 znaków */
const LIMIT_NAZWY_WATKU = 100;
/** Wątek zamyka się sam po dobie od ostatniej wiadomości */
const AUTO_ARCHIWIZACJA_MIN = 1440;

const EMOJI_BOTA = '<:PepeBizensik:1278014731113857037>';
const EMOJI_KANDYDATA = '<:G_SSJCommon:1268828660509573203>';

class InterviewLogService {
    constructor(config) {
        this.config = config;
        this.channelId = config.channels?.interviewLog || null;
        this.enabled = !!this.channelId;

        // userId -> { cel, kolejka, etykieta }
        // `cel` to wątek rozmowy albo sam kanał, gdy wątku nie udało się założyć
        this.sesje = new Map();

        if (this.enabled) {
            logger.info(`📝 Archiwum rozmów rekrutacyjnych aktywne - kanał ${this.channelId}`);
        }
    }

    czyAktywny() {
        return this.enabled === true;
    }

    /* ---------------------------------------------------------------------- */
    /*  SESJA                                                                  */
    /* ---------------------------------------------------------------------- */

    /**
     * Otwiera archiwum jednej rozmowy: wątek na kanale logów z nagłówkiem.
     *
     * Wołane PRZED pierwszą wypowiedzią rekrutera, żeby kolejność wpisów zgadzała się
     * z przebiegiem rozmowy. Niepowodzenie nie przerywa rekrutacji – archiwum po prostu
     * nie powstaje.
     *
     * @param {boolean} opcje.celUstalony kandydat wszedł przyciskiem „Chcę dołączyć do klanu”
     */
    async rozpocznij(client, user, opcje = {}) {
        if (!this.enabled) return;

        // Ponowne kliknięcie przycisku zaczyna rozmowę od nowa - stare archiwum domykamy
        this.sesje.delete(user.id);

        try {
            const kanal = await client.channels.fetch(this.channelId);
            if (!kanal) {
                logger.error(`[ARCHIWUM] ❌ Nie znaleziono kanału ${this.channelId}`);
                return;
            }

            const wejscie = opcje.celUstalony
                ? 'przycisk „Chcę dołączyć do klanu”'
                : 'rekrutacja od zera';

            const naglowek = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('📝 Rozmowa rekrutacyjna')
                .setThumbnail(user.displayAvatarURL())
                .addFields(
                    { name: '👤 Kandydat', value: `${user} (\`${user.tag}\`)`, inline: false },
                    { name: '🆔 ID', value: `\`${user.id}\``, inline: true },
                    { name: '🚪 Wejście', value: wejscie, inline: true }
                )
                .setTimestamp();

            const wiadomosc = await kanal.send({ embeds: [naglowek] });

            // Wątek trzyma całą rozmowę razem - bez niego wpisy kilku kandydatów
            // przeplatałyby się na jednym kanale
            let cel = kanal;
            if (kanal.type === ChannelType.GuildText || kanal.type === ChannelType.GuildAnnouncement) {
                try {
                    cel = await wiadomosc.startThread({
                        name: this._nazwaWatku(user),
                        autoArchiveDuration: AUTO_ARCHIWIZACJA_MIN
                    });
                } catch (error) {
                    logger.warn(`[ARCHIWUM] Nie udało się założyć wątku (${error.message}) - piszę na kanale`);
                }
            }

            this.sesje.set(user.id, {
                cel,
                // Wpisy muszą trafiać na kanał w kolejności, w jakiej padły w rozmowie;
                // kandydat potrafi wysłać dwie wiadomości pod rząd, a ich obsługa biegnie
                // równolegle, więc każdą wysyłkę dokładamy do łańcucha tej sesji
                kolejka: Promise.resolve()
            });
        } catch (error) {
            logger.error(`[ARCHIWUM] ❌ Nie udało się otworzyć archiwum rozmowy: ${error.message}`);
        }
    }

    /** Domyka archiwum – dalsze wpisy dla tego kandydata są ignorowane */
    zakoncz(userId) {
        this.sesje.delete(userId);
    }

    /* ---------------------------------------------------------------------- */
    /*  WPISY                                                                  */
    /* ---------------------------------------------------------------------- */

    /** Wypowiedź rekrutera-AI */
    wpisBota(userId, tekst) {
        return this._wpisz(userId, `${EMOJI_BOTA}  **Rekruter:**\n${tekst}`);
    }

    /** Wiadomość kandydata */
    wpisKandydata(userId, tekst) {
        return this._wpisz(userId, `${EMOJI_KANDYDATA}  **Kandydat:**\n${tekst}`);
    }

    /** Zdarzenie po stronie bota: odczyt zdjęcia, błąd, przerwanie rozmowy */
    wpisSystemowy(userId, tekst) {
        return this._wpisz(userId, `⚙️ *${tekst}*`);
    }

    /**
     * Zdjęcie przesłane przez kandydata razem z tym, co bot z niego odczytał.
     *
     * ⚠️ Plik czytamy do bufora OD RAZU, a samą wysyłkę dokładamy do kolejki i NIE
     * oddajemy jej wołającemu. Zdjęcie Core Stock jest kasowane z dysku zaraz po
     * odczycie, więc wysyłka po ścieżce trafiłaby w pustkę – ale czekanie na upload
     * do Discorda opóźniałoby odpowiedź rekrutera. `await` po stronie wołającego
     * obejmuje więc wyłącznie odczyt pliku: tyle wystarczy, żeby bezpiecznie kasować.
     */
    async wpisZdjecie(userId, sciezkaObrazu, opisAnalizy) {
        const sesja = this.sesje.get(userId);
        if (!sesja) return;

        let bufor = null;
        try {
            bufor = await fs.readFile(sciezkaObrazu);
        } catch (error) {
            logger.warn(`[ARCHIWUM] Nie udało się odczytać zdjęcia do archiwum: ${error.message}`);
        }

        const nazwa = `rozmowa_${userId}_${Date.now()}.png`;
        const tresc = `${EMOJI_KANDYDATA}  **Kandydat przesłał zdjęcie**`;

        this._wKolejce(sesja, async () => {
            await sesja.cel.send({
                content: tresc,
                files: bufor ? [new AttachmentBuilder(bufor, { name: nazwa })] : []
            });
            if (opisAnalizy) {
                await sesja.cel.send({ content: this._przytnij(`⚙️ *${opisAnalizy}*`) });
            }
        });
    }

    /**
     * Zamknięcie archiwum: powód zakończenia i komplet zebranych danych.
     *
     * @param {string} powod np. „komplet danych”, „limit tur”
     * @param {object|null} info karta kandydata (`state.userInfo`)
     */
    async zakonczZPodsumowaniem(userId, powod, info = null) {
        const sesja = this.sesje.get(userId);
        if (!sesja) return;

        const embed = new EmbedBuilder()
            .setColor(info ? 0x57F287 : 0xE67E22)
            .setTitle('🏁 Koniec rozmowy')
            .setDescription(powod)
            .setTimestamp();

        if (info) {
            const coreStock = info.coreStock
                ? Object.entries(info.coreStock).map(([nazwa, ilosc]) => `${nazwa}: ${ilosc}`).join(', ')
                : null;

            const pola = [
                { name: '🎯 Cel wizyty', value: info.purpose || '—', inline: true },
                { name: '🌙 Punkty I fazy', value: info.lunarPoints ?? '—', inline: true },
                { name: '🎮 Nick w grze', value: info.playerNick || '—', inline: true },
                { name: '⚔️ Atak postaci', value: info.characterAttack ?? '—', inline: true },
                { name: '📣 Skąd o nas wie', value: info.referralSource || '—', inline: true }
            ].map(pole => ({ ...pole, value: String(pole.value).slice(0, 1024) }));

            if (coreStock) pola.push({ name: '📦 Core Stock', value: coreStock.slice(0, 1024), inline: false });
            embed.addFields(pola);
        }

        await this._wKolejce(sesja, () => sesja.cel.send({ embeds: [embed] }));
        this.sesje.delete(userId);
    }

    /* ---------------------------------------------------------------------- */
    /*  WEWNĘTRZNE                                                             */
    /* ---------------------------------------------------------------------- */

    _wpisz(userId, tresc) {
        const sesja = this.sesje.get(userId);
        if (!sesja) return Promise.resolve();

        return this._wKolejce(sesja, async () => {
            for (const kawalek of this._podziel(tresc)) {
                await sesja.cel.send({ content: kawalek });
            }
        });
    }

    /**
     * Dokłada zadanie do łańcucha sesji i oddaje obietnicę TEGO zadania.
     *
     * Błąd wysyłki jest wyłapywany i nie zrywa łańcucha – archiwum może zgubić wpis,
     * ale rekrutacja ma toczyć się dalej.
     */
    _wKolejce(sesja, zadanie) {
        const wynik = sesja.kolejka.then(zadanie).catch(error => {
            logger.error(`[ARCHIWUM] ❌ Błąd zapisu wpisu: ${error.message}`);
        });
        sesja.kolejka = wynik;
        return wynik;
    }

    /**
     * Tnie zbyt długą wypowiedź na wiadomości mieszczące się w limicie Discorda.
     *
     * Najpierw szukamy końca akapitu, potem spacji – ale wyłącznie w KOŃCÓWCE kawałka
     * (`MINIMALNE_WYPELNIENIE`). Bez tego warunku wypowiedź bez spacji poza nagłówkiem
     * ucinała się na spacji po emoji: pierwsza wiadomość miała kilkadziesiąt znaków,
     * a cała treść i tak lądowała w następnej.
     */
    _podziel(tresc) {
        if (tresc.length <= LIMIT_WIADOMOSCI) return [tresc];

        const prog = Math.floor(LIMIT_WIADOMOSCI * MINIMALNE_WYPELNIENIE);
        const kawalki = [];
        let reszta = tresc;

        while (reszta.length > LIMIT_WIADOMOSCI) {
            let ciecie = reszta.lastIndexOf('\n', LIMIT_WIADOMOSCI);
            if (ciecie < prog) ciecie = reszta.lastIndexOf(' ', LIMIT_WIADOMOSCI);
            if (ciecie < prog) ciecie = LIMIT_WIADOMOSCI;

            kawalki.push(reszta.slice(0, ciecie));
            reszta = reszta.slice(ciecie).trimStart();
        }
        if (reszta) kawalki.push(reszta);
        return kawalki;
    }

    _przytnij(tresc) {
        return tresc.length > LIMIT_WIADOMOSCI ? `${tresc.slice(0, LIMIT_WIADOMOSCI - 1)}…` : tresc;
    }

    _nazwaWatku(user) {
        const data = new Date().toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' });
        return `${user.username} · ${data}`.slice(0, LIMIT_NAZWY_WATKU);
    }
}

module.exports = InterviewLogService;
