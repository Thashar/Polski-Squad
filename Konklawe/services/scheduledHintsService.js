const path = require('path');
const { v4: uuidv4 } = require('uuid');
const store = require('../../utils/jsonStore');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Konklawe');

class ScheduledHintsService {
    constructor(config, gameService, timerService, passwordEmbedService) {
        this.config = config;
        this.gameService = gameService;
        this.timerService = timerService;
        this.passwordEmbedService = passwordEmbedService;
        this.client = null;

        this.dataFile = path.join(__dirname, '../data/scheduled_hints.json');
        this.scheduledHints = [];
        this.activeTimers = new Map(); // hintId -> timeoutId

        // Inicjalizacja danych
        this.loadScheduledHints();
    }

    /**
     * Ustawia klienta Discord
     * @param {Client} client - Klient Discord
     */
    setClient(client) {
        this.client = client;
    }

    /**
     * Wczytuje zaplanowane podpowiedzi z pliku
     */
    async loadScheduledHints() {
        try {
            const parsed = await store.getOrLoad(this.dataFile, () => ({ scheduledHints: [] }));
            this.scheduledHints = parsed.scheduledHints || [];
            logger.info(`📂 Wczytano ${this.scheduledHints.length} zaplanowanych podpowiedzi`);
        } catch (error) {
            // Brak pliku obsługuje store, więc tu trafiają realne błędy odczytu
            logger.error(`❌ Błąd wczytywania zaplanowanych podpowiedzi: ${error.message}`);
            this.scheduledHints = [];
        }
    }

    /**
     * Zapisuje zaplanowane podpowiedzi do pliku
     */
    async saveScheduledHints() {
        try {
            await store.set(this.dataFile, { scheduledHints: this.scheduledHints });
        } catch (error) {
            logger.error(`❌ Błąd zapisywania zaplanowanych podpowiedzi: ${error.message}`);
        }
    }

    /**
     * Dodaje zaplanowaną podpowiedź
     * @param {string} hintText - Treść podpowiedzi
     * @param {Date} scheduledFor - Data i czas ujawnienia
     * @param {string} addedBy - ID użytkownika
     * @param {string} addedByDisplayName - Wyświetlana nazwa użytkownika na serwerze
     * @returns {Object} - Wynik operacji
     */
    async scheduleHint(hintText, scheduledFor, addedBy, addedByDisplayName) {
        // Walidacja: max 10 zaplanowanych
        const activeScheduled = this.scheduledHints.filter(h => !h.revealed);
        if (activeScheduled.length >= 10) {
            return {
                success: false,
                error: 'Osiągnięto limit 10 zaplanowanych podpowiedzi!'
            };
        }

        // Walidacja: max 24h po ostatniej podpowiedzi
        const lastHintTime = this.gameService.lastHintTimestamp
            ? this.gameService.lastHintTimestamp.getTime()
            : Date.now();

        const maxScheduledTime = lastHintTime + (24 * 60 * 60 * 1000); // 24h po ostatniej

        if (scheduledFor.getTime() > maxScheduledTime) {
            const maxDate = new Date(maxScheduledTime);
            return {
                success: false,
                error: `Podpowiedź można zaplanować maksymalnie 24h po ostatniej podpowiedzi!\nMaksymalny czas: ${maxDate.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })}`
            };
        }

        // Walidacja: nie w przeszłości
        if (scheduledFor.getTime() <= Date.now()) {
            return {
                success: false,
                error: 'Nie można zaplanować podpowiedzi w przeszłości!'
            };
        }

        // Utwórz zaplanowaną podpowiedź
        const scheduledHint = {
            id: uuidv4(),
            hint: hintText,
            scheduledFor: scheduledFor.getTime(),
            addedBy,
            addedByDisplayName,
            revealed: false
        };

        this.scheduledHints.push(scheduledHint);
        await this.saveScheduledHints();

        // Ustaw timer
        this.setTimer(scheduledHint);

        logger.info(`📅 Zaplanowano podpowiedź na ${scheduledFor.toISOString()} przez ${addedByDisplayName}`);

        return {
            success: true,
            hint: scheduledHint
        };
    }

    /**
     * Ustawia timer dla zaplanowanej podpowiedzi
     * @param {Object} scheduledHint - Zaplanowana podpowiedź
     */
    setTimer(scheduledHint) {
        const now = Date.now();
        const delay = scheduledHint.scheduledFor - now;

        if (delay <= 0) {
            // Już minął czas - ujawnij natychmiast
            this.revealHint(scheduledHint.id);
            return;
        }

        // Ustaw timer (max 2147483647ms ~ 24.8 dni)
        const maxDelay = 2147483647;
        const actualDelay = Math.min(delay, maxDelay);

        const timerId = setTimeout(async () => {
            await this.revealHint(scheduledHint.id);
        }, actualDelay);

        this.activeTimers.set(scheduledHint.id, timerId);
        logger.info(`⏰ Ustawiono timer dla podpowiedzi ${scheduledHint.id} (${Math.round(actualDelay / 1000)}s)`);
    }

    /**
     * Ujawnia zaplanowaną podpowiedź
     * @param {string} hintId - ID podpowiedzi
     */
    async revealHint(hintId) {
        const hint = this.scheduledHints.find(h => h.id === hintId);
        if (!hint || hint.revealed) {
            logger.warn(`⚠️ Próba ujawnienia nieistniejącej lub już ujawnionej podpowiedzi: ${hintId}`);
            return;
        }

        // Sprawdź czy gra jest aktywna (hasło istnieje)
        if (!this.gameService.trigger) {
            logger.warn(`⚠️ Anulowano ujawnienie podpowiedzi ${hintId} - brak aktywnego hasła`);
            hint.revealed = true; // Oznacz jako ujawnioną aby nie próbować ponownie
            await this.saveScheduledHints();
            return;
        }

        try {
            // Oznacz jako ujawnioną
            hint.revealed = true;
            await this.saveScheduledHints();

            // Dodaj do gameService jako normalną podpowiedź
            this.gameService.addHint(hint.hint);

            // RESET TIMERÓW - KLUCZOWE!
            // Wyczyść wszystkie timery związane z przypomnieniami o podpowiedziach
            this.timerService.clearHintReminderTimer();
            this.timerService.clearFirstHintReminderTimer();
            this.timerService.clearSecondHintReminderTimer();
            this.timerService.clearPapalRoleRemovalTimer();
            this.timerService.clearRecurringReminderTimer();
            this.timerService.clearHintTimeoutTimer();

            // Ustaw nowy timer dla kolejnej podpowiedzi (6 godzin) i 24h timeout
            await this.timerService.setHintReminderTimer();
            await this.timerService.setHintTimeoutTimer();

            // Zaktualizuj embed
            if (this.passwordEmbedService) {
                await this.passwordEmbedService.updateEmbed(false);

                // Wyślij podpowiedź na kanał command
                await this.passwordEmbedService.sendHintToCommandChannel(
                    hint.hint,
                    `${hint.addedByDisplayName} (zaplanowane)`
                );
            }

            // Usuń timer
            const timerId = this.activeTimers.get(hintId);
            if (timerId) {
                clearTimeout(timerId);
                this.activeTimers.delete(hintId);
            }

            logger.info(`✅ Ujawniono zaplanowaną podpowiedź: "${hint.hint}" (przez ${hint.addedByDisplayName})`);
        } catch (error) {
            logger.error(`❌ Błąd podczas ujawniania podpowiedzi: ${error.message}`);
        }
    }

    /**
     * Usuwa zaplanowaną podpowiedź
     * @param {string} hintId - ID podpowiedzi
     * @returns {boolean} - Czy usunięto
     */
    async removeScheduledHint(hintId) {
        const index = this.scheduledHints.findIndex(h => h.id === hintId && !h.revealed);
        if (index === -1) {
            return false;
        }

        // Usuń timer
        const timerId = this.activeTimers.get(hintId);
        if (timerId) {
            clearTimeout(timerId);
            this.activeTimers.delete(hintId);
        }

        // Usuń z listy
        this.scheduledHints.splice(index, 1);
        await this.saveScheduledHints();

        logger.info(`🗑️ Usunięto zaplanowaną podpowiedź ${hintId}`);
        return true;
    }

    /**
     * Pobiera wszystkie niejawnione zaplanowane podpowiedzi
     * @returns {Array} - Lista zaplanowanych podpowiedzi
     */
    getActiveScheduledHints() {
        return this.scheduledHints
            .filter(h => !h.revealed)
            .sort((a, b) => a.scheduledFor - b.scheduledFor);
    }

    /**
     * Kasuje wszystkie zaplanowane podpowiedzi (przy zmianie hasła/papieża)
     */
    async clearAllScheduled() {
        // Anuluj wszystkie timery
        for (const timerId of this.activeTimers.values()) {
            clearTimeout(timerId);
        }
        this.activeTimers.clear();

        // Usuń wszystkie niejawnione
        this.scheduledHints = this.scheduledHints.filter(h => h.revealed);
        await this.saveScheduledHints();

        logger.info('🗑️ Wyczyszczono wszystkie zaplanowane podpowiedzi');
    }

    /**
     * Sprawdza przegapione podpowiedzi przy starcie bota
     */
    async checkMissedHints() {
        const now = Date.now();
        const missedHints = this.scheduledHints.filter(
            h => !h.revealed && h.scheduledFor <= now
        );

        if (missedHints.length > 0) {
            logger.info(`🔔 Znaleziono ${missedHints.length} przegapionych podpowiedzi - ujawniam...`);

            for (const hint of missedHints) {
                await this.revealHint(hint.id);
                // Dodaj małe opóźnienie między ujawnieniami
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        // Ustaw timery dla pozostałych
        const futureHints = this.scheduledHints.filter(
            h => !h.revealed && h.scheduledFor > now
        );

        for (const hint of futureHints) {
            this.setTimer(hint);
        }

        logger.info(`⏰ Ustawiono timery dla ${futureHints.length} zaplanowanych podpowiedzi`);
    }

    /**
     * Parsuje datę i czas w polskiej strefie czasowej
     * @param {string} dateString - Data w formacie DD.MM.YYYY
     * @param {string} timeString - Czas w formacie HH:MM
     * @returns {Date|null} - Sparsowana data lub null jeśli błąd
     */
    parseDateTime(dateString, timeString) {
        try {
            // Format: DD.MM.YYYY
            const dateParts = dateString.split('.');
            if (dateParts.length !== 3) return null;

            const day = parseInt(dateParts[0]);
            const month = parseInt(dateParts[1]) - 1; // miesiące 0-11
            const year = parseInt(dateParts[2]);

            // Format: HH:MM
            const timeParts = timeString.split(':');
            if (timeParts.length !== 2) return null;

            const hours = parseInt(timeParts[0]);
            const minutes = parseInt(timeParts[1]);

            // Walidacja
            if (isNaN(day) || isNaN(month) || isNaN(year) ||
                isNaN(hours) || isNaN(minutes)) {
                return null;
            }

            if (day < 1 || day > 31 || month < 0 || month > 11 ||
                hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
                return null;
            }

            // Utwórz datę w polskiej strefie czasowej
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
            const localDate = new Date(dateStr);

            // Konwertuj na UTC z polskiej strefy (Europe/Warsaw)
            const offset = this.getPolandOffset(localDate);
            const utcDate = new Date(localDate.getTime() - offset);

            return utcDate;
        } catch (error) {
            logger.error(`❌ Błąd parsowania daty: ${error.message}`);
            return null;
        }
    }

    /**
     * Pobiera offset strefy czasowej Polski dla danej daty (uwzględnia DST)
     * @param {Date} date - Data
     * @returns {number} - Offset w milisekundach
     */
    getPolandOffset(date) {
        // Europa/Warszawa: UTC+1 (zimą) lub UTC+2 (latem - DST)
        const year = date.getFullYear();

        // Ostatnia niedziela marca (początek DST)
        const marchLastSunday = this.getLastSundayOfMonth(year, 2); // marzec = 2
        const dstStart = new Date(year, 2, marchLastSunday, 2, 0, 0); // 02:00

        // Ostatnia niedziela października (koniec DST)
        const octoberLastSunday = this.getLastSundayOfMonth(year, 9); // październik = 9
        const dstEnd = new Date(year, 9, octoberLastSunday, 3, 0, 0); // 03:00

        // Sprawdź czy data jest w okresie DST
        const isDST = date >= dstStart && date < dstEnd;

        // UTC+1 = -60min, UTC+2 = -120min (offset jest odwrotny)
        return isDST ? (2 * 60 * 60 * 1000) : (1 * 60 * 60 * 1000);
    }

    /**
     * Znajduje ostatnią niedzielę miesiąca
     * @param {number} year - Rok
     * @param {number} month - Miesiąc (0-11)
     * @returns {number} - Dzień miesiąca
     */
    getLastSundayOfMonth(year, month) {
        const lastDay = new Date(year, month + 1, 0); // ostatni dzień miesiąca
        const day = lastDay.getDate();
        const dayOfWeek = lastDay.getDay(); // 0 = niedziela

        // Jeśli ostatni dzień to niedziela, zwróć go
        if (dayOfWeek === 0) return day;

        // W przeciwnym razie cofnij się do poprzedniej niedzieli
        return day - dayOfWeek;
    }
}

module.exports = ScheduledHintsService;
