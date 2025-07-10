const { EmbedBuilder } = require('discord.js');

/**
 * Loguje wiadomość z timestampem
 * @param {string} message - Wiadomość do zalogowania
 * @param {string} level - Poziom logowania (info, warn, error)
 */
function logWithTimestamp(message, level = 'info') {
    const timestamp = new Date().toLocaleString('pl-PL', {
        timeZone: 'Europe/Warsaw',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    const logPrefix = `[${timestamp}] [${level.toUpperCase()}]`;
    
    switch(level.toLowerCase()) {
        case 'error':
            console.error(`${logPrefix} ${message}`);
            break;
        case 'warn':
            console.warn(`${logPrefix} ${message}`);
            break;
        case 'info':
            console.info(`${logPrefix} ${message}`);
            break;
        default:
            console.log(`${logPrefix} ${message}`);
    }
}

/**
 * Formatuje wiadomość z zamiennikami
 * @param {string} template - Szablon wiadomości
 * @param {Object} replacements - Obiekt z zamienniki
 * @returns {string} Sformatowana wiadomość
 */
function formatMessage(template, replacements) {
    let message = template;
    for (const [key, value] of Object.entries(replacements)) {
        message = message.replace(new RegExp(`{${key}}`, 'g'), value);
    }
    return message;
}

/**
 * Tworzy embed z logiem
 * @param {string} type - Typ logu
 * @param {string} message - Wiadomość
 * @param {Object} interaction - Interakcja Discord (opcjonalnie)
 * @returns {EmbedBuilder} Embed z logiem
 */
function createLogEmbed(type, message, interaction = null) {
    const embed = new EmbedBuilder()
        .setTitle(`Log: ${type.toUpperCase()}`)
        .setDescription(message)
        .setTimestamp()
        .setColor(getLogColor(type));
    
    if (interaction) {
        embed.addFields([
            { name: 'Użytkownik', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
            { name: 'Serwer', value: interaction.guild.name, inline: true },
            { name: 'Kanał', value: `#${interaction.channel.name}`, inline: true }
        ]);
    }
    
    return embed;
}

/**
 * Zwraca kolor dla danego typu logu
 * @param {string} type - Typ logu
 * @returns {number} Kolor w formacie hex
 */
function getLogColor(type) {
    switch(type.toLowerCase()) {
        case 'error': return 0xFF0000;
        case 'warn': return 0xFFA500;
        case 'info': return 0x0099FF;
        case 'success': return 0x00FF00;
        default: return 0x808080;
    }
}

/**
 * Sprawdza czy plik jest plikiem multimedialnym
 * @param {string} filename - Nazwa pliku
 * @param {Array} supportedExtensions - Wspierane rozszerzenia
 * @returns {boolean} Czy plik jest multimedialny
 */
function isMediaFile(filename, supportedExtensions) {
    const ext = '.' + filename.split('.').pop().toLowerCase();
    return supportedExtensions.includes(ext);
}

/**
 * Tworzy opóźnienie
 * @param {number} ms - Czas opóźnienia w milisekundach
 * @returns {Promise} Promise z opóźnieniem
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generuje hash MD5 z URL
 * @param {string} url - URL do zahashowania
 * @returns {string} Hash MD5
 */
function generateHash(url) {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(url).digest('hex');
}

module.exports = {
    logWithTimestamp,
    formatMessage,
    createLogEmbed,
    getLogColor,
    isMediaFile,
    delay,
    generateHash
};