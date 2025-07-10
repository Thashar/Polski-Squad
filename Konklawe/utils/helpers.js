/**
 * Sprawdza czy tekst składa się z pojedynczego słowa
 * @param {string} text - Tekst do sprawdzenia
 * @returns {boolean} - True jeśli to pojedyncze słowo
 */
function isSingleWord(text) {
    return text.trim().split(/\s+/).length === 1;
}

/**
 * Formatuje różnicę czasu w czytelny sposób
 * @param {number} diffMs - Różnica czasu w milisekundach
 * @returns {string} - Sformatowany tekst
 */
function formatTimeDifference(diffMs) {
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
    let timeText = '';
    if (days > 0) timeText += `${days} dni `;
    if (hours > 0) timeText += `${hours} godz `;
    if (minutes > 0) timeText += `${minutes} min `;
    timeText += `${seconds} sek`;
    return timeText.trim();
}

module.exports = {
    isSingleWord,
    formatTimeDifference
};