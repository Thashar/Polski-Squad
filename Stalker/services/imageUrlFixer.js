const fs = require('fs').promises;
const path = require('path');

const urlsFilePath = path.join(__dirname, '../data/ranking_image_urls.json');

/**
 * Naprawia brakujące pola `url` w ranking_image_urls.json.
 * Podczas transferu zdjęcia zostały wysłane na kanał archiwum, ale wpisy
 * nie zawierają pola `url` - tylko `messageId` i `channelId`.
 * Funkcja pobiera każdą taką wiadomość z Discorda i uzupełnia brakujące URL.
 */
async function fixMissingImageUrls(client, logger) {
    let imageUrls;
    try {
        const data = await fs.readFile(urlsFilePath, 'utf-8');
        imageUrls = JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return; // Plik nie istnieje - nic do naprawy
        }
        logger.error('[IMG-FIX] ❌ Błąd odczytu ranking_image_urls.json:', error.message);
        return;
    }

    const toFix = Object.entries(imageUrls).filter(
        ([, value]) => !value.url && value.messageId && value.channelId
    );

    if (toFix.length === 0) {
        return;
    }

    logger.info(`[IMG-FIX] 🔧 Wykryto ${toFix.length} wpisów bez URL - naprawiam...`);

    let fixed = 0;
    let failed = 0;

    for (const [key, value] of toFix) {
        try {
            const channel = await client.channels.fetch(value.channelId);
            if (!channel) {
                logger.warn(`[IMG-FIX] ⚠️ Nie znaleziono kanału ${value.channelId} dla wpisu: ${key}`);
                failed++;
                continue;
            }

            const message = await channel.messages.fetch(value.messageId);
            if (!message) {
                logger.warn(`[IMG-FIX] ⚠️ Nie znaleziono wiadomości ${value.messageId} dla wpisu: ${key}`);
                failed++;
                continue;
            }

            const url = message.attachments.first()?.url || message.embeds[0]?.image?.url;
            if (!url) {
                logger.warn(`[IMG-FIX] ⚠️ Brak obrazu w wiadomości ${value.messageId} dla wpisu: ${key}`);
                failed++;
                continue;
            }

            imageUrls[key].url = url;
            fixed++;
            logger.info(`[IMG-FIX] ✅ Naprawiono: ${key}`);
        } catch (error) {
            logger.warn(`[IMG-FIX] ❌ Błąd dla wpisu ${key}: ${error.message}`);
            failed++;
        }
    }

    if (fixed > 0) {
        try {
            await fs.writeFile(urlsFilePath, JSON.stringify(imageUrls, null, 2));
            logger.info(`[IMG-FIX] ✅ Zapisano naprawy: ${fixed} naprawiono, ${failed} nieudanych`);
        } catch (error) {
            logger.error('[IMG-FIX] ❌ Błąd zapisu pliku:', error.message);
        }
    } else if (failed > 0) {
        logger.warn(`[IMG-FIX] ⚠️ Żadnego wpisu nie udało się naprawić (${failed} błędów)`);
    }
}

module.exports = { fixMissingImageUrls };
