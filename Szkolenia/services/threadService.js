const { createBotLogger } = require('../../utils/consoleLogger');
const { daysToMilliseconds } = require('../utils/helpers');
const ReminderStorageService = require('./reminderStorageService');

const logger = createBotLogger('Szkolenia');
const reminderStorage = new ReminderStorageService();

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Ile wątków pobierać jednym żądaniem archiwum (maksimum akceptowane przez Discord to 100).
const WATKOW_NA_STRONE = 100;
// Ile stron archiwum wolno przejrzeć przy wyszukiwaniu wątku (reakcja użytkownika — musi być szybko).
const MAKS_STRON_PRZY_SZUKANIU = 10;
// Ile stron archiwum przechodzimy przy codziennym sprawdzaniu (raz dziennie, może potrwać dłużej).
const MAKS_STRON_PRZY_SPRAWDZANIU = 20;

/**
 * Pobiera zarchiwizowane wątki kanału, przechodząc przez kolejne strony wyników.
 *
 * ⚠️ `fetchArchived()` zwraca tylko JEDNĄ stronę (domyślnie 50 wątków). Kanał szkoleń ma
 * historię liczoną w setkach wątków, więc bez stronicowania starszy wątek użytkownika jest
 * niewidoczny — bot zakłada wtedy DRUGI wątek o tej samej nazwie.
 *
 * @param {TextChannel} channel - Kanał szkoleń
 * @param {Object} opcje
 * @param {number} opcje.maxStron - Górny limit stron (zabezpieczenie przed zalewem żądań)
 * @param {Function|null} opcje.dopasuj - Predykat; gdy zwróci true, przerywamy pobieranie
 * @returns {Promise<{watki: Map, znaleziony: ?Object, kompletna: boolean}>}
 *          `kompletna` = przejrzano CAŁE archiwum (Discord nie zgłasza już `hasMore`)
 */
async function pobierzArchiwalneWatki(channel, { maxStron = MAKS_STRON_PRZY_SPRAWDZANIU, dopasuj = null } = {}) {
    const watki = new Map();
    let before;

    for (let strona = 0; strona < maxStron; strona++) {
        const zapytanie = { limit: WATKOW_NA_STRONE };
        if (before) zapytanie.before = before;

        const wynik = await channel.threads.fetchArchived(zapytanie);

        for (const [id, watek] of wynik.threads) {
            watki.set(id, watek);
            if (dopasuj && dopasuj(watek)) {
                return { watki, znaleziony: watek, kompletna: false };
            }
        }

        if (!wynik.hasMore || wynik.threads.size === 0) {
            return { watki, znaleziony: null, kompletna: true };
        }

        before = wynik.threads.last();
    }

    return { watki, znaleziony: null, kompletna: false };
}

/**
 * Pobiera wątek po ID i sprawdza, czy należy do wskazanego kanału.
 * Zwraca null, gdy wątek został usunięty z Discorda.
 */
async function pobierzWatekPoId(channel, threadId) {
    try {
        const watek = await channel.threads.fetch(threadId);
        if (watek && watek.parentId === channel.id) return watek;
    } catch (error) {
        // Wątek usunięty albo bez dostępu — traktujemy jak nieistniejący
    }
    return null;
}

/**
 * Szuka wątku szkoleniowego danego użytkownika.
 *
 * Kolejność ma znaczenie — od źródeł pewnych i tanich do kosztownych:
 *  1. wątek wyrastający z tej samej wiadomości (ID wątku = ID wiadomości startowej) —
 *     niezależny od nazwy, więc działa też po zmianie nicku,
 *  2. zapisany `ownerId` w `reminders.json` — wiąże wątek z użytkownikiem, nie z nickiem,
 *  3. aktywne wątki pobrane z API (`fetchActive`), nie z cache,
 *  4. archiwum ze stronicowaniem — dopasowanie po nazwie.
 *
 * ⚠️ Punkty 3 i 4 dopasowują po NAZWIE, więc po zmianie nicku zadziałają tylko punkty 1-2.
 * Dlatego `ownerId` musi przetrwać zamknięcie wątku (patrz `markThreadClosed`).
 *
 * @returns {Promise<?ThreadChannel>}
 */
async function znajdzWatekUzytkownika(channel, { message, ownerId, threadName, reminderMap }) {
    // 1. Wątek założony z tej samej wiadomości — ma to samo ID co wiadomość
    if (message?.hasThread) {
        const watek = await pobierzWatekPoId(channel, message.id);
        if (watek) return watek;
    }

    // 2. Wątek zapisany dla tego właściciela
    if (ownerId && reminderMap) {
        for (const [threadId, dane] of reminderMap) {
            if (!dane || dane.ownerId !== ownerId) continue;
            const watek = await pobierzWatekPoId(channel, threadId);
            if (watek) return watek;
        }
    }

    // 3. Aktywne wątki — z API, bo cache bywa niekompletny (sprzątany przez discord.js)
    try {
        const aktywne = await channel.threads.fetchActive();
        const znaleziony = aktywne.threads.find(watek => watek.name === threadName);
        if (znaleziony) return znaleziony;
    } catch (error) {
        logger.warn(`⚠️ Nie udało się pobrać aktywnych wątków: ${error.message}`);
    }

    // 4. Archiwum po nazwie
    try {
        const { znaleziony } = await pobierzArchiwalneWatki(channel, {
            maxStron: MAKS_STRON_PRZY_SZUKANIU,
            dopasuj: watek => watek.name === threadName
        });
        if (znaleziony) return znaleziony;
    } catch (error) {
        logger.warn(`⚠️ Nie udało się przeszukać archiwum wątków: ${error.message}`);
    }

    return null;
}

/**
 * Otwiera wątek: zdejmuje archiwizację i blokadę.
 *
 * ⚠️ Jednym żądaniem (`edit`), bo osobne `setArchived` + `setLocked` potrafią się wykluczać —
 * zarchiwizowanego wątku nie da się edytować inaczej niż polem `archived`, więc odblokowanie
 * po nieudanym odarchiwizowaniu też pada. Wcześniej oba błędy były tylko logowane, a kod leciał
 * dalej do `send()`, który wywracał się na zamkniętym wątku — użytkownik nie dostawał regułki.
 *
 * @returns {Promise<boolean>} czy wątek jest gotowy do pisania
 */
async function otworzWatek(watek) {
    if (!watek.archived && !watek.locked) return true;

    try {
        await watek.edit({
            archived: false,
            locked: false,
            reason: 'Ponowne otwarcie wątku szkoleniowego'
        });
        logger.info(`📂 Otwarto ponownie wątek: ${watek.name}`);
        return true;
    } catch (error) {
        logger.warn(`⚠️ Nie udało się otworzyć wątku ${watek.name} jednym żądaniem: ${error.message}`);
    }

    // Zapas: krok po kroku — najpierw archiwizacja, dopiero potem blokada
    try {
        if (watek.archived) {
            await watek.setArchived(false, 'Ponowne otwarcie wątku szkoleniowego');
        }
        if (watek.locked) {
            await watek.setLocked(false, 'Odblokowanie wątku na prośbę użytkownika');
        }
        return !watek.archived && !watek.locked;
    } catch (error) {
        logger.error(`❌ Nie można otworzyć wątku ${watek.name}: ${error.message}`);
        return false;
    }
}

async function checkThreads(client, state, config, isInitialCheck = false) {
    try {
        const guild = client.guilds.cache.first();
        const channel = await guild.channels.fetch(config.channels.training);

        if (!channel.isTextBased() || !channel.threads) return;

        const now = Date.now();
        const lockThreshold = daysToMilliseconds(config.timing.threadLockDays);
        const reminderThreshold = daysToMilliseconds(config.timing.threadReminderDays);

        const activeThreads = await channel.threads.fetchActive();
        const { watki: archiwalne, kompletna } = await pobierzArchiwalneWatki(channel);
        const allThreads = new Map([...activeThreads.threads, ...archiwalne]);

        // ⚠️ Czyścimy osierocone wpisy TYLKO gdy przejrzeliśmy całe archiwum. Przy niepełnej
        // liście skasowalibyśmy stan wątków, które nadal istnieją (m.in. `reminderSent`
        // i `ownerId`), przez co przypomnienie poszłoby drugi raz zamiast zamknięcia wątku,
        // a bot zgubiłby powiązanie wątku z właścicielem.
        if (kompletna) {
            await reminderStorage.cleanupOrphanedReminders(state.lastReminderMap, allThreads);
        } else {
            logger.info('ℹ️ Lista zarchiwizowanych wątków niekompletna — pomijam czyszczenie przypomnień');
        }

        for (const [id, thread] of allThreads) {
            try {
                await processThread(thread, guild, state, config, now, {
                    lockThreshold,
                    reminderThreshold
                }, isInitialCheck);
            } catch (error) {
                logger.error(`❌ Błąd podczas przetwarzania wątku ${thread.name}:`, error);
            }
        }

    } catch (error) {
        logger.error('❌ Błąd podczas sprawdzania wątków:', error);
    }
}

async function processThread(thread, guild, state, config, now, thresholds, isInitialCheck = false) {
    const { lockThreshold, reminderThreshold } = thresholds;

    // Wątek już zablokowany (zamknięty) — nie przetwarzaj go ponownie.
    // Bez tego przy każdym restarcie dawno zamknięte wątki były odarchiwizowywane,
    // dostawały ponownie komunikat o zamknięciu i były zamykane od nowa.
    // Sprawdzenie PRZED pobraniem wiadomości i PRZED threadOwner (działa też po zmianie nicku).
    if (thread.locked) {
        await reminderStorage.markThreadClosed(state.lastReminderMap, thread.id);
        return;
    }

    const lastMessage = await thread.messages.fetch({ limit: 1 }).then(msgs => msgs.first());
    const lastMessageTime = lastMessage ? lastMessage.createdTimestamp : thread.createdTimestamp;
    const inactiveTime = now - lastMessageTime;

    if (inactiveTime > lockThreshold) {
        await lockThread(thread, state, config);
        return;
    }

    const threadData = state.lastReminderMap.get(thread.id);

    if (threadData && threadData.reminderSent) {
        if (lastMessageTime > threadData.lastReminder + 5000) {
            await reminderStorage.resetReminderStatus(state.lastReminderMap, thread.id, lastMessageTime);
        } else {
            const timeSinceReminder = now - threadData.lastReminder;
            if (timeSinceReminder > reminderThreshold) {
                await lockThread(thread, state, config);
                return;
            }
        }
    }

    if (isInitialCheck) return;

    const threadOwner = await resolveThreadOwner(thread, guild, threadData);
    if (!threadOwner) return;

    const reminderAlreadySent = threadData && threadData.reminderSent;

    if (inactiveTime > reminderThreshold && !reminderAlreadySent) {
        const lastReminderTime = threadData ? threadData.lastReminder : 0;
        const timeSinceLastReminder = lastReminderTime ? (now - lastReminderTime) : Infinity;

        if (timeSinceLastReminder > reminderThreshold) {
            await sendInactivityReminder(thread, threadOwner, state, config, now);
        }
    }
}

/**
 * Ustala właściciela wątku.
 *
 * ⚠️ Samo szukanie po nazwie w `guild.members.cache` bywa zawodne: cache członków
 * zapełnia się dopiero ze zdarzeń, więc po restarcie bota potrafi być prawie pusty
 * — a wtedy przypomnienie nie szło wcale, bez śladu w logu. ID właściciela jest
 * zapisywane przy zakładaniu wątku (`setReminder(..., targetUser.id)`), więc korzystamy
 * z niego w pierwszej kolejności, a szukanie po nazwie zostaje jako zapas dla
 * starych wpisów bez `ownerId`.
 */
async function resolveThreadOwner(thread, guild, threadData) {
    if (threadData?.ownerId) {
        try {
            return await guild.members.fetch(threadData.ownerId);
        } catch {
            // Użytkownik mógł opuścić serwer — spróbujemy jeszcze po nazwie
        }
    }

    return guild.members.cache.find(member =>
        (member.displayName === thread.name) || (member.user.username === thread.name)
    ) || null;
}

async function sendInactivityReminder(thread, threadOwner, state, config, now) {
    try {
        if (thread.archived) {
            await thread.setArchived(false, 'Odarchiwizowanie w celu wysłania przypomnienia');
        }

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('lock_thread')
                    .setLabel('Zamknij szkolenie')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('keep_open')
                    .setLabel('Jeszcze nie zamykaj')
                    .setStyle(ButtonStyle.Secondary)
            );

        await thread.send({
            content: config.messages.inactiveReminder(threadOwner.id),
            components: [row]
        });

        await reminderStorage.setReminder(state.lastReminderMap, thread.id, now);
        await reminderStorage.markReminderSent(state.lastReminderMap, thread.id);
        logger.info(`💬 Wysłano przypomnienie: ${thread.name}`);

    } catch (error) {
        logger.error(`❌ Błąd podczas wysyłania przypomnienia do wątku ${thread.name}:`, error);
    }
}

async function lockThread(thread, state, config) {
    try {
        // Zabezpieczenie: nie zamykaj ponownie wątku, który jest już zablokowany
        // (uniknij odarchiwizowania i ponownego wysłania komunikatu o zamknięciu).
        if (thread.locked) {
            await reminderStorage.markThreadClosed(state.lastReminderMap, thread.id);
            return;
        }

        if (thread.archived) {
            await thread.setArchived(false, 'Odarchiwizowanie w celu zamknięcia wątku');
        }

        await thread.send(config.messages.threadLocked);
        await thread.setLocked(true, `Wątek nieaktywny przez ${config.timing.threadLockDays} dni - automatycznie zamknięty`);
        await thread.setArchived(true, 'Zamknięcie wątku po okresie nieaktywności');

        await reminderStorage.markThreadClosed(state.lastReminderMap, thread.id);
        logger.info(`🔒 Zamknięto wątek: ${thread.name}`);
    } catch (error) {
        logger.error(`❌ Błąd podczas zamykania wątku ${thread.name}:`, error);
    }
}


module.exports = {
    checkThreads,
    reminderStorage,
    znajdzWatekUzytkownika,
    otworzWatek,
    pobierzArchiwalneWatki
};
