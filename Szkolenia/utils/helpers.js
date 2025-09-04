/**
 * Funkcje pomocnicze dla bota Szkolenia.
 * -------------------------------------------------
 * • opóźnienia i timing
 * • formatowanie czasów
 * • walidacja danych
 */

/**
 * Opóźnienie wykonania o określoną liczbę milisekund
 * @param {number} ms - Czas opóźnienia w milisekundach
 * @returns {Promise} - Promise który rozwiązuje się po określonym czasie
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Formatowanie czasu w formacie czytelnym dla użytkownika
 * @param {number} timestamp - Timestamp do sformatowania
 * @returns {string} - Sformatowany czas
 */
function formatTime(timestamp) {
    return new Date(timestamp).toLocaleString('pl-PL', {
        timeZone: 'Europe/Warsaw',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * Obliczanie czasu, który minął od określonego momentu
 * @param {number} timestamp - Timestamp punkt odniesienia
 * @returns {string} - Czas który minął w czytelnym formacie
 */
function getTimeElapsed(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
        return `${days} dni temu`;
    } else if (hours > 0) {
        return `${hours} godzin temu`;
    } else {
        return `${minutes} minut temu`;
    }
}

/**
 * Konwersja dni na milisekundy
 * @param {number} days - Liczba dni
 * @returns {number} - Liczba milisekund
 */
function daysToMilliseconds(days) {
    return days * 24 * 60 * 60 * 1000;
}

/**
 * Konwersja godzin na milisekundy
 * @param {number} hours - Liczba godzin
 * @returns {number} - Liczba milisekund
 */
function hoursToMilliseconds(hours) {
    return hours * 60 * 60 * 1000;
}

/**
 * Sprawdzenie czy użytkownik ma którąś z wymaganych ról
 * @param {GuildMember} member - Członek serwera
 * @param {string[]} roleIds - Tablica ID ról do sprawdzenia
 * @returns {boolean} - True jeśli użytkownik ma którejś z ról
 */
function hasAnyRole(member, roleIds) {
    return member.roles.cache.some(role => roleIds.includes(role.id));
}

/**
 * Bezpieczne pobranie nazwy użytkownika (displayName lub username)
 * @param {GuildMember} member - Członek serwera
 * @returns {string} - Nazwa użytkownika
 */
function getUserName(member) {
    return member.displayName || member.user.username;
}

/**
 * Sprawdzenie czy wątek należy do systemu (nazwa = nick użytkownika)
 * @param {ThreadChannel} thread - Wątek do sprawdzenia
 * @param {Guild} guild - Serwer Discord
 * @returns {GuildMember|null} - Właściciel wątku lub null
 */
function getThreadOwner(thread, guild) {
    return guild.members.cache.find(member => 
        (member.displayName === thread.name) || (member.user.username === thread.name)
    );
}

// Funkcja logWithTimestamp usunięta - używaj createBotLogger z utils/consoleLogger.js

module.exports = {
    delay,
    formatTime,
    getTimeElapsed,
    daysToMilliseconds,
    hoursToMilliseconds,
    hasAnyRole,
    getUserName,
    getThreadOwner,
    // logWithTimestamp - usunięto, używaj createBotLogger
};