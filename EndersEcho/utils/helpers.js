const https = require('https');
const http = require('http');
const fs = require('fs');
const { URL } = require('url');

const ALLOWED_HOSTS = new Set([
    'cdn.discordapp.com',
    'media.discordapp.net',
    'images-ext-1.discordapp.net',
    'images-ext-2.discordapp.net',
    'attachments.discord-activities.com',
]);

const MAX_DOWNLOAD_SIZE = 25 * 1024 * 1024; // 25 MB

function validateUrl(rawUrl) {
    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error(`Nieprawidłowy URL: ${rawUrl}`);
    }
    if (parsed.protocol !== 'https:') {
        throw new Error(`Dozwolony wyłącznie protokół HTTPS`);
    }
    if (!ALLOWED_HOSTS.has(parsed.hostname)) {
        throw new Error(`Host "${parsed.hostname}" nie jest dozwolony`);
    }
    return parsed;
}

/**
 * Formatuje wiadomość z parametrami
 * @param {string} template - Szablon wiadomości
 * @param {Object} params - Parametry do zastąpienia
 * @returns {string} - Sformatowana wiadomość
 */
function formatMessage(template, params) {
    let formatted = template;
    for (const [key, value] of Object.entries(params)) {
        formatted = formatted.replace(new RegExp(`{${key}}`, 'g'), value);
    }
    return formatted;
}

/**
 * Pobiera plik z URL (tylko z dozwolonych hostów Discord CDN)
 * @param {string} url - URL do pobrania
 * @param {string} filepath - Ścieżka do zapisu pliku
 * @returns {Promise<void>}
 */
async function downloadFile(url, filepath) {
    validateUrl(url);
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(filepath);
        let totalSize = 0;

        https.get(url, (response) => {
            response.on('data', chunk => {
                totalSize += chunk.length;
                if (totalSize > MAX_DOWNLOAD_SIZE) {
                    response.destroy();
                    file.close();
                    reject(new Error(`Plik przekracza limit ${MAX_DOWNLOAD_SIZE / 1024 / 1024} MB`));
                    return;
                }
                file.write(chunk);
            });
            response.on('end', () => { file.close(); resolve(); });
            response.on('error', err => { file.close(); reject(err); });
        }).on('error', reject);
    });
}

/**
 * Pobiera plik z URL do bufora w pamięci (tylko z dozwolonych hostów Discord CDN)
 * @param {string} url - URL do pobrania
 * @returns {Promise<Buffer>}
 */
async function downloadBuffer(url) {
    validateUrl(url);
    return new Promise((resolve, reject) => {
        const chunks = [];
        let totalSize = 0;

        https.get(url, (response) => {
            response.on('data', chunk => {
                totalSize += chunk.length;
                if (totalSize > MAX_DOWNLOAD_SIZE) {
                    response.destroy();
                    reject(new Error(`Plik przekracza limit ${MAX_DOWNLOAD_SIZE / 1024 / 1024} MB`));
                    return;
                }
                chunks.push(chunk);
            });
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
        }).on('error', reject);
    });
}

/**
 * Sortuje graczy malejąco po wyniku. Przy remisie (identyczny scoreValue)
 * gracz, który zdobył wynik WCZEŚNIEJ (starszy timestamp), jest wyżej —
 * ten kto powtórzył wynik jako drugi ląduje niżej.
 * @param {{scoreValue: number, timestamp?: string}} a
 * @param {{scoreValue: number, timestamp?: string}} b
 * @returns {number}
 */
function compareByScoreThenTimestamp(a, b) {
    if (b.scoreValue !== a.scoreValue) return b.scoreValue - a.scoreValue;
    const aTime = a.timestamp ? new Date(a.timestamp).getTime() : Infinity;
    const bTime = b.timestamp ? new Date(b.timestamp).getTime() : Infinity;
    return aTime - bTime;
}

// ===== PROFILE GRACZA (multi-profile) =====
//
// Jeden użytkownik Discorda może mieć kilka profili (grać na kilku kontach w grze).
// Tożsamość wpisu w danych = playerKey:
//   profil główny (1):    "123456789012345678"        ← identyczny jak dawny userId (zgodność wstecz)
//   profil dodatkowy (2): "123456789012345678#2"
//
// Separator "#" jest wybrany świadomie: customId komponentów Discorda parsowane są przez
// split('_') i split(':'), więc żaden z tych znaków nie może wystąpić w playerKey.
// "#" jest też bezpieczny w nazwach plików (historia wyników = plik per profil).
const PROFILE_SEPARATOR = '#';

// Znaczniki profili w nazwach wyświetlanych: profil 1 = brak znacznika (bez zmian dla graczy
// z jednym profilem), profile 2+ = cyfra w kółku doklejona do nicku Discord.
// Tablice pokrywają domyślny limit ENDERSECHO_MAX_PROFILES=3; przy wyższym limicie
// znacznik degraduje się do "(N)", a emoji na komponencie znika (sama etykieta).
const PROFILE_MARKERS = ['', '', '②', '③'];

// Znaczniki profili na KOMPONENTACH Discorda (przyciski, opcje select menu).
// Znaki z PROFILE_MARKERS (②, ③) to zwykłe znaki Unicode, a NIE emoji — Discord
// odrzuca je w polu emoji komponentu błędem COMPONENT_INVALID_EMOJI. Do komponentów
// używamy więc keycapów (cyfra + VS16 + COMBINING ENCLOSING KEYCAP), które są emoji.
// Emoji oznacza SLOT (stały numer profilu), nie to, który profil jest mainem —
// main jest oznaczany osobno pinezką 📌, bo może nim być dowolny slot.
const PROFILE_BUTTON_EMOJIS = ['', '1️⃣', '2️⃣', '3️⃣'];

/**
 * Buduje playerKey z ID właściciela i numeru profilu.
 * @param {string} userId - ID użytkownika Discord
 * @param {number} [profileIndex=1] - numer profilu (1 = główny)
 * @returns {string}
 */
function makePlayerKey(userId, profileIndex = 1) {
    const idx = Number(profileIndex) || 1;
    return idx <= 1 ? String(userId) : `${userId}${PROFILE_SEPARATOR}${idx}`;
}

/**
 * Zwraca ID użytkownika Discord (właściciela) z playerKey.
 * Bezpieczne dla zwykłego userId — zwraca go bez zmian.
 * @param {string} playerKey
 * @returns {string}
 */
function getOwnerId(playerKey) {
    if (playerKey === null || playerKey === undefined) return playerKey;
    const str = String(playerKey);
    const sepIdx = str.indexOf(PROFILE_SEPARATOR);
    return sepIdx === -1 ? str : str.slice(0, sepIdx);
}

/**
 * Zwraca numer profilu z playerKey (1 dla profilu głównego / zwykłego userId).
 * @param {string} playerKey
 * @returns {number}
 */
function getProfileIndex(playerKey) {
    if (!playerKey) return 1;
    const str = String(playerKey);
    const sepIdx = str.indexOf(PROFILE_SEPARATOR);
    if (sepIdx === -1) return 1;
    const parsed = parseInt(str.slice(sepIdx + 1), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * Czy playerKey wskazuje profil dodatkowy (nie główny).
 * @param {string} playerKey
 * @returns {boolean}
 */
function isAltProfile(playerKey) {
    return getProfileIndex(playerKey) > 1;
}

/**
 * Formatuje nazwę wyświetlaną profilu: nick Discord + znacznik numeru profilu.
 * Profil główny zwraca nick bez zmian — dzięki temu gracze z jednym profilem
 * widzą dokładnie to samo co przed wdrożeniem profili.
 * @param {string} baseName - nick Discord (displayName / username)
 * @param {number|string} profileIndexOrKey - numer profilu albo playerKey
 * @returns {string}
 */
function formatProfileDisplayName(baseName, profileIndexOrKey) {
    const idx = typeof profileIndexOrKey === 'number'
        ? profileIndexOrKey
        : getProfileIndex(profileIndexOrKey);
    if (idx <= 1) return baseName;
    const marker = PROFILE_MARKERS[idx] || `(${idx})`;
    return `${baseName} ${marker}`;
}

/**
 * Zwraca sam znacznik profilu (do embedów, gdzie nick jest w innym polu).
 * Profil główny → null.
 * @param {number|string} profileIndexOrKey
 * @returns {string|null}
 */
function getProfileMarker(profileIndexOrKey) {
    const idx = typeof profileIndexOrKey === 'number'
        ? profileIndexOrKey
        : getProfileIndex(profileIndexOrKey);
    if (idx <= 1) return null;
    return PROFILE_MARKERS[idx] || `(${idx})`;
}

/**
 * Emoji profilu na przycisk / opcję select menu Discorda.
 * Profil główny → 🏠, profile 2–9 → keycap (2️⃣…9️⃣), poza zakresem → null
 * (komponent zostaje bez emoji, sama etykieta — zamiast błędu walidacji Discorda).
 * @param {number|string} profileIndexOrKey
 * @returns {string|null}
 */
function getProfileButtonEmoji(profileIndexOrKey) {
    const idx = typeof profileIndexOrKey === 'number'
        ? profileIndexOrKey
        : getProfileIndex(profileIndexOrKey);
    return PROFILE_BUTTON_EMOJIS[idx] || null;
}

module.exports = {
    formatMessage,
    downloadFile,
    downloadBuffer,
    compareByScoreThenTimestamp,
    PROFILE_SEPARATOR,
    makePlayerKey,
    getOwnerId,
    getProfileIndex,
    isAltProfile,
    formatProfileDisplayName,
    getProfileMarker,
    getProfileButtonEmoji
};